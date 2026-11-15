#!/usr/bin/env python3
"""Compile the actual MEF builder and evaluate its bytecode against protocol frames."""
from pathlib import Path
import ipaddress
import os
import re
import shutil
import struct
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parents[1] / 'source/wlan_src/mlinux'
DRIVER = SOURCE / 'moal_rp1_filter.h'


def function(raw, name):
    match = re.search(r'(?m)^(?:(?:static )?[A-Za-z_][A-Za-z0-9_ *]*\n)?' + re.escape(name) + r'\(', raw)
    assert match, 'Missing driver function ' + name
    closing = re.search(r'(?m)^}', raw[match.end():])
    assert closing, 'Missing function end ' + name
    return raw[match.start():match.end() + closing.end()] + '\n'


def expression(raw):
    """Decode firmware postfix operands independently of the C template emitter."""
    def sequence(end):
        assert end >= 2 and raw[end - 1] == 2
        count = raw[end - 2]
        assert count and end >= count + 2
        return raw[end - count - 2:end - 2], end - count - 2

    def number(end):
        assert end >= 5 and raw[end - 1] == 1
        return struct.unpack_from('<I', raw, end - 5)[0], end - 5

    def take(end):
        operation = raw[end - 1]
        if operation in (0x44, 0x45):
            right, at = take(end - 1)
            left, at = take(at)
            combine = (lambda data: left(data) and right(data)) if operation == 0x44 else (
                lambda data: left(data) or right(data))
            return combine, at
        if operation == 0x43:
            mask, at = sequence(end - 1)
            offset, at = number(at)
            pattern, at = sequence(at)
            assert len(mask) == len(pattern)
            return lambda data: len(data[offset:offset + len(mask)]) == len(mask) and all(
                (value & bitmask) == expected for value, bitmask, expected
                in zip(data[offset:offset + len(mask)], mask, pattern)), at
        assert operation == 0x41, 'Unexpected MEF operation'
        offset, at = number(end - 1)
        pattern, at = sequence(at)
        repeat, at = number(at)
        assert repeat == 1, 'Only exact one-repeat templates are expected'
        return lambda data: data[offset:offset + len(pattern)] == pattern, at
    result, at = take(len(raw))
    assert at == 0, 'Unconsumed MEF bytes'
    return result


def entries(raw, count=7):
    result, at = [], 0
    while at < len(raw):
        assert len(raw) - at >= 4
        mode, action, size = struct.unpack_from('<BBH', raw, at)
        assert mode == 1, 'Every rule must be host-sleep-only'
        assert size and size <= len(raw) - at - 4
        assert size <= 100, 'MEF expression exceeds the firmware stack'
        program = raw[at + 4:at + 4 + size]
        result.append((action, expression(program), raw[at:at + 4 + size]))
        at += 4 + size
    assert at == len(raw) and len(result) == count
    assert count <= 8 and len(raw) <= 417, 'Table exceeds what the firmware applied in standby'
    assert [item[0] for item in result] == [16, 3, 3, 3, 3, 3, 0]
    return result


def ethernet(ether_type, body):
    return bytes.fromhex('020000000001020000000002') + ether_type + body


def to_mac(mac, frame):
    return bytes.fromhex(mac) + frame[6:]


def broadcast(frame):
    return b'\xff' * 6 + frame[6:]


def ipv4(destination, protocol=17, source='192.168.1.1', source_port=53,
         destination_port=50000, ihl=5, fragment=0x4000, first_byte=None):
    body = bytearray(struct.pack('!HHHH', source_port, destination_port, 16, 0) + bytes(8))
    if first_byte is not None:
        body[0] = first_byte
    header = bytearray(ihl * 4)
    header[0], header[8], header[9] = 0x40 | ihl, 64, protocol
    header[2:4] = struct.pack('!H', len(header) + len(body))
    header[6:8] = struct.pack('!H', fragment)
    header[12:16] = ipaddress.IPv4Address(source).packed
    header[16:20] = ipaddress.IPv4Address(destination).packed
    return ethernet(b'\x08\x00', header + body)


def firmware_frame(frame):
    # The vendor firmware sees LLC/SNAP before EtherType: EN10MB offsets grow by eight.
    return frame[:12] + struct.pack('!H', len(frame) - 6) + b'\xaa\xaa\x03\x00\x00\x00' + frame[12:]


def ipv6(destination, next_header=6, payload=bytes(16)):
    header = bytearray(40)
    header[0], header[6], header[7] = 0x60, next_header, 64
    header[4:6] = struct.pack('!H', len(payload))
    header[8:24] = ipaddress.IPv6Address('2001:db8::2').packed
    header[24:40] = ipaddress.IPv6Address(destination).packed
    return ethernet(b'\x86\xdd', header + payload)


def arp(opcode, target, mac):
    body = struct.pack('!HHBBH', 1, 0x0800, 6, 4, opcode)
    body += bytes.fromhex('020000000002') + ipaddress.IPv4Address('192.0.2.1').packed
    body += mac + ipaddress.IPv4Address(target).packed
    return ethernet(b'\x08\x06', body)


def dhcp(mac, flags=0, ihl=5, protocol=17, source_port=67, destination_port=68):
    frame = bytearray(ipv4('255.255.255.255', protocol, source_port=source_port,
                          destination_port=destination_port, ihl=ihl, fragment=flags))
    bootp = bytearray(236)
    bootp[:4], bootp[28:34] = bytes((2, 1, 6, 0)), mac
    offset = 14 + ihl * 4
    frame = frame[:offset + 8] + bootp
    frame[16:18] = struct.pack('!H', len(frame) - 14)
    frame[offset + 4:offset + 6] = struct.pack('!H', 8 + len(bootp))
    return broadcast(frame)


def verify_packets(raw, address, mac):
    table = entries(raw)
    def first_action(frame, asleep=True):
        return next((action for action, test, _ in table
                     if asleep and test(firmware_frame(frame))), None)
    def matches(frame):
        return [action for action, test, _ in table if test(firmware_frame(frame))]

    positive = {
        'local ARP request': (arp(1, address, mac), 16),
        'local ARP reply': (arp(2, address, mac), 3),
        'broadcast local ARP request': (broadcast(arp(1, address, mac)), 16),
        'HTTP response': (ipv4(address, 6, source_port=80), 3),
        'HTTPS response': (ipv4(address, 6, source_port=443), 3),
        'DNS UDP response': (ipv4(address, source_port=53), 3),
        'DNS TCP response': (ipv4(address, 6, source_port=53), 3),
        'NTP response': (ipv4(address, source_port=123), 3),
        'ICMP to local IPv4': (ipv4(address, 1), 3),
        'ordinary local UDP': (ipv4(address, source='203.0.113.9', destination_port=49152), 3),
        'EAPOL': (ethernet(b'\x88\x8e', bytes(16)), 3),
    }
    for flags in (0, 0x4000):
        positive['own DHCP broadcast ' + hex(flags)] = (dhcp(mac, flags), 3)
    # Ordinary packets to the current IPv4 are not narrowed by port, source,
    # fragment flags, or the BOOTP client qualifier used for broadcast DHCP.
    for protocol in (1, 6, 17):
        for flags in (0, 1, 0x2000, 0x4001):
            positive['local IPv4 fragment ' + str(protocol) + '/' + hex(flags)] = (
                ipv4(address, protocol, fragment=flags), 3)
    positive['unicast DHCP to local IPv4 is ordinary IPv4'] = (
        ipv4(address, source_port=67, destination_port=68), 3)
    assert matches(arp(1, address, mac)) == [16, 0], 'Auto reply must precede the catch-all'
    assert matches(arp(2, address, mac)) == [3, 0], 'ARP reply must wake before the catch-all'
    other = '192.0.2.254'
    assert address != other
    negative = {
        'other ARP request': arp(1, other, mac),
        'other ARP reply': arp(2, other, mac),
        'unsupported ARP opcode': arp(3, address, mac),
        'other IPv4': ipv4(other),
        'mesh EtherType': broadcast(ethernet(b'\x30\x99', bytes(64))),
        'router UDP9801': broadcast(ipv4('255.255.255.255', destination_port=9801)),
        'HA UDP1900': broadcast(ipv4('255.255.255.255', destination_port=1900)),
        'mDNS': ipv4('224.0.0.251', destination_port=5353),
        'SSDP multicast': ipv4('239.255.255.250', destination_port=1900),
        'IGMP over unicast MAC': ipv4('224.0.0.1', 2, ihl=6, first_byte=0x11),
        'IPv6 unicast': ipv6('2001:db8::135'),
        'MLD over unicast MAC': ipv6('ff02::1', 58, b'\x82' + bytes(31)),
        'MLD over multicast MAC': to_mac('333300000001', ipv6('ff02::1', 58, b'\x82' + bytes(31))),
        'unknown EtherType': ethernet(b'\x88\xb5', bytes(16)),
        'DHCP IHL6': dhcp(mac, ihl=6),
        'DHCP wrong protocol': dhcp(mac, protocol=6),
        'DHCP wrong source port': dhcp(mac, source_port=68),
        'DHCP wrong destination port': dhcp(mac, destination_port=67),
        'DHCP missing chaddr': dhcp(mac)[:60],
    }
    for byte in (0, 5):
        foreign = bytearray(mac)
        foreign[byte] ^= 1
        negative['DHCP other client byte ' + str(byte)] = dhcp(foreign)
    for flags in (1, 0x1fff, 0x2000, 0x4001, 0x6000, 0x8000):
        negative['DHCP fragment/reserved ' + hex(flags)] = dhcp(mac, flags)
    for name, (frame, expected) in positive.items():
        assert first_action(frame) == expected, name
        assert first_action(frame, asleep=False) is None, name + ': applied while awake'
    for name, frame in negative.items():
        assert first_action(frame) == 0, name
        assert first_action(frame, asleep=False) is None, name + ': applied while awake'
    assert table[-1][1](bytes(range(256))), 'Zero-mask catch-all must match arbitrary data'
    return len(positive), len(negative)


def verify_lifecycle(raw):
    assert 'rp1_rules_fops' not in raw and 'proc_create(' not in raw, 'Obsolete custom rules file remains'
    for filename, names in {
        'moal_ioctl.c': ['woal_enable_hs'],
        'moal_sta_cfg80211.c': ['woal_cfg80211_suspend', 'woal_cfg80211_resume'],
        'moal_sdio_mmc.c': ['woal_sdio_suspend', 'woal_sdio_resume'],
    }.items():
        source = (SOURCE / filename).read_text()
        for name in names:
            body = function(source, name)
            assert 'rp1_filter_' not in body, name + ': filter programming entered the PM path'
    assert 'alloc_workqueue("rp1_sleep_filter", WQ_FREEZABLE | WQ_UNBOUND, 1)' in raw
    notifier = function(raw, 'rp1_filter_inet_event')
    assert 'queue_work(state->queue' in notifier
    assert 'rp1_filter_program' not in notifier and 'AddRemoveCardSem' not in notifier
    cleanup = function(raw, 'rp1_filter_stop')
    operations = ['unregister_inetaddr_notifier', 'cancel_work_sync', 'destroy_workqueue', 'kfree(state)']
    positions = [cleanup.index(operation) for operation in operations]
    assert positions == sorted(positions), 'Callback/work lifetime is not ended before state free'
    assert cleanup.index('handle->rp1_filter = NULL') < positions[0]
    assert cleanup.index('state->stopping = true') < positions[0]
    main = (SOURCE / 'moal_main.c').read_text()
    for name, later in {
        'woal_free_moal_handle': 'wiphy_unregister',
        'woal_remove_card': 'handle->surprise_removed',
        'woal_switch_drv_mode': 'woal_reset_intf',
        'woal_cleanup_module': 'woal_check_driver_status',
    }.items():
        body = function(main, name)
        assert body.index('rp1_filter_stop(handle)') < body.index(later), name
    assert 'rp1_rules_proc' not in main, 'Obsolete rules-file lifecycle remains'
    setter = function(main, 'woal_set_mac_address')
    assert 'woal_rp1_filter_event' in setter, 'STA MAC changes must queue a whitelist rebuild'
    resume = function((SOURCE / 'moal_sta_cfg80211.c').read_text(), 'woal_cfg80211_resume')
    assert resume.count('rp1_count_wake(') == 1
    reload_body = function(main, 'woal_request_fw_reload')
    assert reload_body.index('rp1_filter_pause(handle)') < reload_body.index('handle->driver_state')
    assert 'cancel_work_sync' in function(raw, 'rp1_filter_pause')
    print('PASS source lifetime guards: dedicated freezable queue, address/MAC rebuild hooks, PM paths untouched, and work stops before interface/handle teardown')


def build_review(folder, source):
    binary = folder / 'review'
    subprocess.run(['clang', '-std=gnu11', '-O1', '-g', '-Wall', '-Wextra', '-Werror',
                    '-fsanitize=address,undefined', '-fno-omit-frame-pointer',
                    str(folder / source), '-o', str(binary)], check=True)
    return binary


def main():
    raw = DRIVER.read_text()
    begin, end = '/* RP1_MEF_BUILDER_BEGIN */', '/* RP1_MEF_BUILDER_END */'
    assert raw.count(begin) == raw.count(end) == 1, 'Missing actual-builder extraction bounds'
    builder = raw.split(begin, 1)[1].split(end, 1)[0]
    verify_lifecycle(raw)
    env = dict(os.environ, ASAN_OPTIONS='detect_leaks=0', UBSAN_OPTIONS='halt_on_error=1')
    with tempfile.TemporaryDirectory(prefix='rp1-sleep-mef-') as tmp:
        folder = Path(tmp)
        (folder / 'sleep_builder.h').write_text(builder)
        shutil.copy2(HERE / 'sleep_filter_review.c', folder / 'review.c')
        binary = build_review(folder, 'review.c')
        inputs = (('192.168.100.135', 'ac8995f7b315'), ('10.21.34.56', '020000000004'))
        for address, mac_hex in inputs:
            path = folder / 'entries.bin'
            subprocess.run([str(binary), *address.split('.'), mac_hex, str(path)], env=env, check=True)
            actual = path.read_bytes()
            assert len(actual) == 356
            if (address, mac_hex) == inputs[0]:
                assert actual == (HERE / 'whitelist-reference.entries.bin').read_bytes(), \
                    'Builder differs from the firmware-tested seven-entry whitelist'
            else:
                table = entries(actual)
                assert next(action for action, test, _ in table
                            if test(firmware_frame(ipv4(inputs[0][0])))) == 0, 'Stale IPv4 remains allowed'
                assert next(action for action, test, _ in table
                            if test(firmware_frame(dhcp(bytes.fromhex(inputs[0][1]))))) == 0, 'Stale chaddr remains allowed'
            allowed, dropped = verify_packets(actual, address, bytes.fromhex(mac_hex))
            print(f'PASS actual whitelist for {address}/{mac_hex}: seven mode-1 entries/356 bytes, '
                  f'{allowed} first-match allow/offload and {dropped} catch-all cases')
        damaged = bytearray(path.read_bytes())
        damaged[0] = 0
        try:
            entries(damaged)
        except AssertionError:
            print('PASS validator rejects an awake-active template')
        else:
            raise AssertionError('Mode regression escaped detection')
        (folder / 'sleep_program.h').write_text(function(raw, 'rp1_filter_program'))
        shutil.copy2(HERE / 'sleep_program_review.c', folder / 'program.c')
        binary = build_review(folder, 'program.c')
        subprocess.run([str(binary)], env=env, check=True)
        state = re.search(r'(?ms)^struct rp1_filter_state \{.*?^};', raw)
        assert state, 'Missing actual filter state'
        (folder / 'sleep_state.h').write_text(state[0] + '\n')
        (folder / 'sleep_priv.h').write_text(function(raw, 'rp1_filter_priv'))
        (folder / 'sleep_worker.h').write_text(function(raw, 'rp1_filter_work'))
        (folder / 'sleep_event.h').write_text(function(raw, 'woal_rp1_filter_event'))
        shutil.copy2(HERE / 'sleep_worker_review.c', folder / 'worker.c')
        binary = build_review(folder, 'worker.c')
        subprocess.run([str(binary)], env=env, check=True)
        for label, header, source, old, new in [
            ('PENDING request freed by caller', 'sleep_program.h', 'program.c',
             'if (result != MLAN_STATUS_PENDING)', 'if (1)'),
            ('missing fail-open command', 'sleep_worker.h', 'worker.c',
             'fallback = rp1_filter_program(priv, NULL, false);', 'fallback = MLAN_STATUS_SUCCESS;'),
            ('off switch skips firmware cleanup', 'sleep_worker.h', 'worker.c',
             'if (!enable && !state->dirty)', 'if (!enable)'),
        ]:
            path = folder / header
            original = path.read_text()
            assert old in original, label + ': missing mutation target'
            try:
                path.write_text(original.replace(old, new, 1))
                binary = build_review(folder, source)
                result = subprocess.run([str(binary)], env=env, capture_output=True, text=True)
                assert result.returncode and 'assert' in result.stderr.lower(), label
            finally:
                path.write_text(original)
            print('PASS negative control detects ' + label)
    print('Sleep-MEF checks use actual driver construction; firmware acceptance and physical sleep require RP1 validation.')


if __name__ == '__main__':
    main()
