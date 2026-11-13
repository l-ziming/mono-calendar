"""Manifest and source checks for the on-device App; runs the pure-Java checks when a JDK exists."""

from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET

project_root = Path(__file__).resolve().parents[2]
android_namespace = '{http://schemas.android.com/apk/res/android}'
manifest = ET.parse(project_root / 'android/AndroidManifest.xml').getroot()
permissions = {permission.get(android_namespace + 'name') for permission in manifest.iter('uses-permission')}
assert 'android.permission.CHANGE_WIFI_STATE' not in permissions, 'the App must never control Wi-Fi'
assert 'android.permission.ACCESS_WIFI_STATE' not in permissions
sync_service = next(s for s in manifest.iter('service') if s.get(android_namespace + 'name') == '.SyncService')
assert (
    sync_service.get(android_namespace + 'process') == ':sync'
    and sync_service.get(android_namespace + 'exported') == 'false'
)
setup_receiver = next(r for r in manifest.iter('receiver') if r.get(android_namespace + 'name') == '.SetupReceiver')
assert setup_receiver.get(android_namespace + 'permission') == 'android.permission.DUMP'
java_source = ''.join(source_path.read_text('utf-8') for source_path in (project_root / 'android/src').rglob('*.java'))
for forbidden in ('WifiManager', 'setWifiEnabled', 'reconnect()', '/frame', '/tap'):
    assert forbidden not in java_source, forbidden
# The page is drawn on the RP1; the only decoded picture is the 128 px hint icon from GET /image.
assert java_source.count('BitmapFactory.decode') == 2 and '"/image"' in java_source, 'only the hint icon may be decoded'
assert 'GET /data' in java_source or '"/data"' in java_source
javac = shutil.which('javac')
jdk_bin = Path(os.environ.get('JAVA_HOME', '/nonexistent')) / 'bin'
if (jdk_bin / 'javac').exists():
    javac = str(jdk_bin / 'javac')
if javac:
    with tempfile.TemporaryDirectory() as classes_dir:
        sources = [
            str(project_root / 'android/src/dev/monocalendar/rp1' / filename)
            for filename in (
                'QuarterClock.java',
                'HintRetry.java',
                'ConnectionSettings.java',
                'Almanac.java',
                'Json.java',
                'Optimistic.java',
                'AlmanacNotes.java',
                'Page.java',
                'Ink.java',
                'Svg.java',
                'RemoteState.java',
                'Requests.java',
            )
        ]
        receiver = (project_root / 'android/src/dev/monocalendar/rp1/WakeReceiver.java').read_text()
        # Keep every receiver method; the test supplies its Android boundary types.
        for android_import in ('import android.app.*;\n', 'import android.content.*;\n', 'import android.os.PowerManager;\n'):
            assert receiver.count(android_import) == 1
            receiver = receiver.replace(android_import, '')
        receiver_path = Path(classes_dir) / 'WakeReceiver.java'
        receiver_path.write_text(receiver)
        sources.append(str(receiver_path))
        subprocess.run(
            [
                javac,
                '-encoding',
                'UTF-8',
                '-d',
                classes_dir,
                *sources,
                str(project_root / 'tests/android/QuarterClockCheck.java'),
                str(project_root / 'tests/android/HintRetryCheck.java'),
                str(project_root / 'tests/android/WakeReceiverCheck.java'),
                str(project_root / 'tests/android/AlmanacCheck.java'),
                str(project_root / 'tests/android/WeatherCheck.java'),
                str(project_root / 'tests/android/RemoteStateCheck.java'),
                str(project_root / 'tests/android/RequestsCheck.java'),
            ],
            check=True,
        )
        java_runner = str(Path(javac).with_name('java'))
        check_classes = [
            'QuarterClockCheck',
            'HintRetryCheck',
            'dev.monocalendar.rp1.WakeReceiverCheck',
            'AlmanacCheck',
            'dev.monocalendar.rp1.WeatherCheck',
            'RemoteStateCheck',
            'RequestsCheck',
        ]
        for class_name in check_classes:
            command = [java_runner, '-ea', '-cp', classes_dir]
            if class_name == 'AlmanacCheck':
                command.append('-Dproject=' + str(project_root))
            command.append(class_name)
            subprocess.run(command, check=True)

print(
    'Android checks passed: no Wi-Fi control, isolated :sync process, protected setup receiver, quarter policy, almanac, request overlay and read ordering'
)
