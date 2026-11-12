#!/usr/bin/env python3
"""Install the built APK and provision its connection through the permission-protected ADB receiver."""

import argparse
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

project_root = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('profile', nargs='?', default=str(project_root / '.local/rp1-connection.json'))
    parser.add_argument('--serial', default=os.environ.get('RP1_SERIAL'))
    args = parser.parse_args()
    profile = json.loads(Path(args.profile).read_text())
    endpoint = profile['endpoint'].rstrip('/')
    token = profile['token']
    parsed_endpoint = urlsplit(endpoint)
    if (
        parsed_endpoint.scheme not in {'http', 'https'}
        or not parsed_endpoint.hostname
        or parsed_endpoint.username
        or parsed_endpoint.password
        or parsed_endpoint.path
        or parsed_endpoint.query
        or parsed_endpoint.fragment
    ):
        raise ValueError('Invalid endpoint in the local connection profile')
    if not re.fullmatch(r'[!-~]{24,256}', token):
        raise ValueError('Invalid token in the local connection profile')
    adb = shutil.which('adb') or 'adb'
    target = ['-d']
    if args.serial:
        target = ['-s', args.serial]
    scheduled = profile.get('scheduled', True)

    def run_adb(*parts):
        result = subprocess.run([adb, *target, *parts], capture_output=True, text=True)
        output = (result.stdout + result.stderr).replace(token, '[redacted]')
        if result.returncode:
            print(output, file=sys.stderr)
            raise SystemExit(result.returncode)
        return output

    print(run_adb('install', '-r', str(project_root / 'dist/rp1-calendar.apk')).strip())
    scheduled_value = 'false'
    if scheduled:
        scheduled_value = 'true'
    command = shlex.join(
        [
            'am',
            'broadcast',
            '-a',
            'dev.monocalendar.rp1.CONFIGURE',
            '-n',
            'dev.monocalendar.rp1/.SetupReceiver',
            '--es',
            'endpoint',
            endpoint,
            '--es',
            'token',
            token,
            '--ez',
            'scheduled',
            scheduled_value,
        ]
    )
    output = run_adb('shell', command)
    if 'result=-1' not in output:
        print(output, file=sys.stderr)
        raise SystemExit('Device did not confirm connection settings')
    print('RP1 connection configured: ' + endpoint)
    if scheduled:
        print('The app has started; its quarter-hour refresh schedule is enabled.')
    else:
        print('The app has started; automatic refresh is disabled.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError):
        raise SystemExit('Could not read a valid connection profile or start ADB.')
