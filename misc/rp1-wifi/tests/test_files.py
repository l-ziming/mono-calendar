#!/usr/bin/env python3
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


BUNDLE = Path(__file__).resolve().parents[1]
WRAPPER = r'''#!/usr/bin/env python3
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

root = Path(__file__).parent
config = json.loads((root / "control.json").read_text())
arguments = sys.argv[1:]
command = "restorecon" if Path(sys.argv[0]).name == "restorecon" else arguments.pop(0)
with (root / "calls.jsonl").open("a") as stream:
    stream.write(json.dumps([command, *arguments]) + "\n")
block = root / "block-ro"
mounts = root / "mounts"
if command == "blockdev":
    if arguments[0] == "--getro":
        print(block.read_text().strip())
    else:
        block.write_text("1" if arguments[0] == "--setro" else "0")
elif command == "mount":
    mode = arguments[1].split(",")[1]
    if config.get("fail_mount_" + mode):
        sys.exit(1)
    assert block.read_text() == "0" or mode == "ro"
    mounts.write_text("fake " + str(root / "system") + " ext4 " + mode + ",relatime 0 0\n")
elif command == "sha256sum":
    print(hashlib.sha256(Path(arguments[0]).read_bytes()).hexdigest(), " " + arguments[0])
elif command == "restorecon":
    assert arguments[0] == "-R"
elif command == "sync":
    pass
else:
    if command in ["mkdir", "cp", "mv", "rm", "chmod"]:
        assert " ext4 rw," in mounts.read_text() and block.read_text() == "0"
    if command == "cp" and config.get("fail_copy"):
        sys.exit(1)
    sys.exit(subprocess.run([command, *arguments]).returncode)
'''


class FilesTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="rp1-wifi-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.bundle = self.root / "bundle"
        self.bundle.mkdir()
        for name in ["original", "patched"]:
            shutil.copytree(BUNDLE / name, self.bundle / name)
        self.system = self.root / "system"
        (self.system / "lib").mkdir(parents=True)
        self.target = self.system / "lib/modules"
        self.control = self.root / "control.json"
        self.control.write_text("{}")
        self.mounts = self.root / "mounts"
        self.mounts.write_text(f"fake {self.system} ext4 ro,relatime 0 0\n")
        (self.root / "block-ro").write_text("1")
        for name in ["busybox", "restorecon"]:
            wrapper = self.root / name
            wrapper.write_text(WRAPPER)
            wrapper.chmod(0o755)
        source = (BUNDLE / "files.sh").read_text()
        for old, new in {
            "busybox=/system/bin/busybox": f"busybox={self.root}/busybox",
            "restorecon=/system/bin/restorecon": f"restorecon={self.root}/restorecon",
            "system=/system": f"system={self.system}",
            "block=/dev/block/mmcblk0p9": f"block={self.root}/device",
            "mounts=/proc/mounts": f"mounts={self.mounts}",
        }.items():
            assert source.count(old + "\n") == 1
            source = source.replace(old + "\n", new + "\n")
        self.script = self.bundle / "files.sh"
        self.script.write_text(source)

    def run_action(self, action, succeeds=True):
        result = subprocess.run(["/bin/sh", str(self.script), action], capture_output=True, text=True)
        if succeeds:
            self.assertEqual(result.returncode, 0, result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn("RP1_WIFI_FILES_INSTALLED", result.stdout)
            self.assertNotIn("RP1_WIFI_FILES_ROLLED_BACK", result.stdout)
        return result

    def calls(self):
        path = self.root / "calls.jsonl"
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def assert_restored(self, mode="ro", block="1"):
        self.assertIn(f" ext4 {mode},", self.mounts.read_text())
        self.assertEqual((self.root / "block-ro").read_text(), block)
        self.assertEqual(list((self.system / "lib").glob(".mono-calendar-wifi.*")), [])

    def test_install_repeat_and_rollback(self):
        self.assertIn("STATUS=absent", self.run_action("status").stdout)
        self.assertEqual(self.run_action("install").stdout, "RP1_WIFI_FILES_INSTALLED\n")
        self.assert_restored()
        self.assertEqual({path.name for path in self.target.iterdir()},
                         {"mlan8897.ko", "sd8897.ko", ".mono-calendar-version"})
        self.assertEqual(self.target.stat().st_mode & 0o777, 0o755)
        for path in self.target.iterdir():
            self.assertEqual(path.stat().st_mode & 0o777, 0o644)
        self.assertIn("STATUS=installed", self.run_action("status").stdout)
        mounts = sum(call[0] == "mount" for call in self.calls())
        self.run_action("install")
        self.assertEqual(sum(call[0] == "mount" for call in self.calls()), mounts)
        self.assertEqual(self.run_action("rollback").stdout, "RP1_WIFI_FILES_ROLLED_BACK\n")
        self.assertFalse(self.target.exists())
        self.assert_restored()
        self.run_action("rollback")
        self.assert_restored()

    def test_corrupted_source_is_rejected_before_remount(self):
        for name in ["original/mlan8897.ko", "patched/sd8897.ko"]:
            with self.subTest(name=name):
                path = self.bundle / name
                contents = path.read_bytes()
                path.write_bytes(b"damaged")
                self.run_action("install", succeeds=False)
                self.assertFalse(self.target.exists())
                self.assertFalse(any(call[0] == "mount" for call in self.calls()))
                self.assert_restored()
                path.write_bytes(contents)

    def test_unknown_directory_and_symbolic_links_are_rejected(self):
        self.target.mkdir()
        (self.target / "unrelated.ko").write_text("leave this alone")
        for action in ["install", "rollback"]:
            self.run_action(action, succeeds=False)
            self.assertEqual((self.target / "unrelated.ko").read_text(), "leave this alone")
        shutil.rmtree(self.target)
        self.target.symlink_to(self.root / "missing")
        self.run_action("install", succeeds=False)
        self.run_action("rollback", succeeds=False)
        self.assertTrue(self.target.is_symlink())
        self.target.unlink()
        self.run_action("install")
        module = self.target / "mlan8897.ko"
        module.unlink()
        module.symlink_to(self.bundle / "patched/mlan8897.ko")
        self.run_action("rollback", succeeds=False)
        self.assertTrue(module.is_symlink())
        self.assert_restored()

    def test_hidden_extra_file_prevents_deletion(self):
        self.run_action("install")
        (self.target / ".unrelated").write_text("keep")
        self.run_action("rollback", succeeds=False)
        self.assertEqual((self.target / ".unrelated").read_text(), "keep")
        self.assert_restored()

    def test_failed_writable_remount_preserves_previous_source(self):
        self.control.write_text('{"fail_mount_rw":true}')
        self.run_action("install", succeeds=False)
        self.assertFalse(self.target.exists())
        self.assert_restored()
        self.control.write_text("{}")
        self.run_action("install")
        before = {path.name: path.read_bytes() for path in self.target.iterdir()}
        self.control.write_text('{"fail_mount_rw":true}')
        self.run_action("rollback", succeeds=False)
        self.assertEqual({path.name: path.read_bytes() for path in self.target.iterdir()}, before)
        self.assert_restored()

    def test_failed_readonly_restore_does_not_report_success(self):
        self.control.write_text('{"fail_mount_ro":true}')
        result = self.run_action("install", succeeds=False)
        self.assertIn("Could not restore", result.stderr)
        self.assertTrue(self.target.is_dir())
        self.assertEqual((self.root / "block-ro").read_text(), "1")

    def test_failed_copy_removes_owned_staging_directory(self):
        self.control.write_text('{"fail_copy":true}')
        self.run_action("install", succeeds=False)
        self.assertFalse(self.target.exists())
        self.assert_restored()

    def test_original_writable_flags_are_preserved(self):
        self.mounts.write_text(f"fake {self.system} ext4 rw,relatime 0 0\n")
        (self.root / "block-ro").write_text("0")
        self.run_action("install")
        self.assert_restored("rw", "0")
        self.run_action("rollback")
        self.assert_restored("rw", "0")


if __name__ == "__main__":
    unittest.main()
