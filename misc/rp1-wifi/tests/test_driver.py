"""Exercise host recovery without ADB or a real RP1."""

from contextlib import redirect_stderr, redirect_stdout
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, call


PACKAGE = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('rp1_wifi_driver', PACKAGE / 'driver.py')
driver = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(driver)


class DriverChecks(unittest.TestCase):
    def device(self, directory, wifi_enabled=True):
        device = Mock(spec=driver.Device)
        device.backup.return_value = (Path(directory), 'boot-before')
        device.remote_hash.return_value = 'boot-before'
        device.status.return_value = {
            'wifi_enabled': wifi_enabled,
            'system_block_ro': '1',
            'system_mount': 'ro,seclabel,relatime,data=ordered',
            'versions': {module: 'C509' for module in driver.MODULES},
        }
        device.start_wifi.return_value = device.status.return_value
        return device

    def test_failed_patch_load_stops_and_restores_stock_pair(self):
        with tempfile.TemporaryDirectory() as directory, redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            device = self.device(directory)
            device.start_wifi.side_effect = [RuntimeError('patch did not load'), device.status.return_value]

            with self.assertRaisesRegex(RuntimeError, 'patch did not load'):
                driver.change(device, 'install', {})

            changes = [item for item in device.method_calls if item[0] in ('stop_wifi', 'files', 'start_wifi')]
            self.assertEqual(changes, [
                call.stop_wifi(), call.files('install'), call.start_wifi(driver.VERSION),
                call.stop_wifi(), call.files('rollback'), call.start_wifi('C509'),
            ])
            device.restore_system_protection.assert_called_once_with(device.status.return_value)
            self.assertFalse((Path(directory) / 'result.json').exists())

    def test_failed_rollback_never_reinstalls_patch(self):
        with tempfile.TemporaryDirectory() as directory, redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            device = self.device(directory)
            device.files.side_effect = RuntimeError('rollback failed')

            with self.assertRaisesRegex(RuntimeError, 'rollback failed'):
                driver.change(device, 'rollback', {})

            device.files.assert_called_once_with('rollback')
            device.start_wifi.assert_not_called()
            device.shell.assert_any_call('svc wifi enable')
            device.restore_system_protection.assert_called_once_with(device.status.return_value)
            self.assertFalse((Path(directory) / 'result.json').exists())

    def test_initially_disabled_wifi_is_restored_on_success_and_failure(self):
        for failed in (False, True):
            with self.subTest(failed=failed), tempfile.TemporaryDirectory() as directory, redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                device = self.device(directory, wifi_enabled=False)
                if failed:
                    device.files.side_effect = [RuntimeError('install failed'), None]
                    with self.assertRaisesRegex(RuntimeError, 'install failed'):
                        driver.change(device, 'install', {})
                else:
                    driver.change(device, 'install', {})

                wifi_changes = [item for item in device.method_calls if item[0] == 'shell' and item.args[0].startswith('svc wifi ')]
                self.assertEqual(wifi_changes[-1], call.shell('svc wifi disable'))
                device.restore_system_protection.assert_called_once_with(device.status.return_value)

    def test_readonly_restore_failure_still_restores_disabled_wifi(self):
        with tempfile.TemporaryDirectory() as directory, redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            device = self.device(directory, wifi_enabled=False)
            device.restore_system_protection.side_effect = RuntimeError('readonly restore failed')

            with self.assertRaisesRegex(RuntimeError, 'readonly restore failed'):
                driver.change(device, 'install', {})

            device.shell.assert_any_call('svc wifi disable')
            self.assertFalse((Path(directory) / 'result.json').exists())

    def test_operation_error_survives_cleanup_failures(self):
        for action in ('install', 'rollback'):
            for readonly_failed, wifi_failed in ((True, False), (False, True), (True, True)):
                with self.subTest(action=action, readonly_failed=readonly_failed, wifi_failed=wifi_failed):
                    with tempfile.TemporaryDirectory() as directory:
                        errors = io.StringIO()
                        device = self.device(directory, wifi_enabled=False)
                        original_error = RuntimeError('original operation failed')
                        device.files.side_effect = [original_error, None]
                        if readonly_failed:
                            device.restore_system_protection.side_effect = RuntimeError('readonly restore failed')

                        def shell(command):
                            if wifi_failed and command == 'svc wifi disable':
                                raise RuntimeError('wifi restore failed')
                            return ''

                        device.shell.side_effect = shell
                        with redirect_stdout(io.StringIO()), redirect_stderr(errors):
                            with self.assertRaises(RuntimeError) as caught:
                                driver.change(device, action, {})

                        self.assertIs(caught.exception, original_error)
                        device.restore_system_protection.assert_called_once_with(device.status.return_value)
                        device.shell.assert_any_call('svc wifi disable')
                        if readonly_failed:
                            self.assertIn('readonly restore failed', errors.getvalue())
                        if wifi_failed:
                            self.assertIn('wifi restore failed', errors.getvalue())
                        self.assertFalse((Path(directory) / 'result.json').exists())

    def test_successful_operation_reports_first_cleanup_error(self):
        for readonly_failed in (False, True):
            with self.subTest(readonly_failed=readonly_failed), tempfile.TemporaryDirectory() as directory:
                errors = io.StringIO()
                device = self.device(directory, wifi_enabled=False)
                readonly_error = RuntimeError('readonly restore failed')
                wifi_error = RuntimeError('wifi restore failed')
                if readonly_failed:
                    device.restore_system_protection.side_effect = readonly_error

                def shell(command):
                    if command == 'svc wifi disable':
                        raise wifi_error
                    return ''

                device.shell.side_effect = shell
                with redirect_stdout(io.StringIO()), redirect_stderr(errors):
                    with self.assertRaises(RuntimeError) as caught:
                        driver.change(device, 'install', {})

                expected_error = wifi_error
                if readonly_failed:
                    expected_error = readonly_error
                    self.assertIn('wifi restore failed', errors.getvalue())
                self.assertIs(caught.exception, expected_error)
                device.shell.assert_any_call('svc wifi disable')
                self.assertFalse((Path(directory) / 'result.json').exists())

    def test_rollback_error_survives_wifi_restart_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            errors = io.StringIO()
            device = self.device(directory)
            original_error = RuntimeError('rollback failed')
            device.files.side_effect = original_error

            def shell(command):
                if command == 'svc wifi enable':
                    raise RuntimeError('wifi restart failed')
                return ''

            device.shell.side_effect = shell
            with redirect_stdout(io.StringIO()), redirect_stderr(errors):
                with self.assertRaises(RuntimeError) as caught:
                    driver.change(device, 'rollback', {})

            self.assertIs(caught.exception, original_error)
            self.assertIn('wifi restart failed', errors.getvalue())
            device.restore_system_protection.assert_called_once_with(device.status.return_value)
            self.assertFalse((Path(directory) / 'result.json').exists())

    def test_cleanup_error_is_not_hidden_by_outer_exception_handler(self):
        with tempfile.TemporaryDirectory() as directory:
            device = self.device(directory)
            cleanup_error = RuntimeError('readonly restore failed')
            device.restore_system_protection.side_effect = cleanup_error

            try:
                raise RuntimeError('unrelated caller failure')
            except RuntimeError:
                with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                    with self.assertRaises(RuntimeError) as caught:
                        driver.change(device, 'install', {})

            self.assertIs(caught.exception, cleanup_error)
            self.assertFalse((Path(directory) / 'result.json').exists())

    def test_interrupt_survives_cleanup_failures(self):
        with tempfile.TemporaryDirectory() as directory:
            errors = io.StringIO()
            device = self.device(directory, wifi_enabled=False)
            original_error = KeyboardInterrupt('interrupted')
            device.files.side_effect = [original_error, None]
            device.restore_system_protection.side_effect = RuntimeError('readonly restore failed')

            def shell(command):
                if command == 'svc wifi disable':
                    raise RuntimeError('wifi restore failed')
                return ''

            device.shell.side_effect = shell
            with redirect_stdout(io.StringIO()), redirect_stderr(errors):
                with self.assertRaises(KeyboardInterrupt) as caught:
                    driver.change(device, 'install', {})

            self.assertIs(caught.exception, original_error)
            self.assertIn('readonly restore failed', errors.getvalue())
            self.assertIn('wifi restore failed', errors.getvalue())
            device.shell.assert_any_call('svc wifi disable')
            self.assertFalse((Path(directory) / 'result.json').exists())

    def test_legacy_adb_zero_exit_still_requires_remote_completion(self):
        device = object.__new__(driver.Device)
        device.run = Mock(return_value='remote command failed\n')
        with self.assertRaisesRegex(RuntimeError, 'remote command failed'):
            device.shell('false')

        device.run.return_value = 'data\nMONO_CALENDAR_WIFI_COMMAND_OK\n'
        self.assertEqual(device.shell('echo data'), 'data')
        command = device.run.call_args.args[1]
        self.assertIn('set -eu', command)


if __name__ == '__main__':
    unittest.main()
