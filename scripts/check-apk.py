import pathlib
import sys
import zipfile

apk_path, badging_path = map(pathlib.Path, sys.argv[1:])
text = badging_path.read_text()
assert "sdkVersion:'22'" in text and "targetSdkVersion:'22'" in text
assert "package: name='dev.monocalendar.rp1'" in text
assert "versionCode='19'" in text and "versionName='0.7.9'" in text
assert 'CHANGE_WIFI_STATE' not in text, 'The App must not control Wi-Fi'
with zipfile.ZipFile(apk_path) as archive:
    members = set(archive.namelist())
    assert 'classes.dex' in members
    # D8 must remove Java lambda bootstrap references unavailable on API 22.
    assert b'Ljava/lang/invoke/' not in archive.read('classes.dex')
    native_library = archive.read('lib/armeabi-v7a/librp1_epd.so')
    assert native_library[:5] == b'\x7fELF\x01'  # ELF32
    assert int.from_bytes(native_library[18:20], 'little') == 40  # ARM
    assert b'Java_dev_monocalendar_rp1_MainActivity_refreshHint' in native_library
    assert not any('arm64' in name for name in members)
    for name in ('assets/almanac.bin', 'assets/almanac-lists.txt'):
        assert name in members, name
    assert len(archive.read('assets/almanac.bin')) % 13 == 0
    for font, license_name in [
        ('NotoSansSC-Regular.otf', 'OFL-NotoSansSC.txt'),
        ('NotoSansSC-Medium.otf', 'OFL-NotoSansSC.txt'),
        ('NotoSansSC-Bold.otf', 'OFL-NotoSansSC.txt'),
        ('NotoSerifSC-Medium.otf', 'OFL-NotoSerifSC.txt'),
        ('NotoSerifSC-Bold.otf', 'OFL-NotoSerifSC.txt'),
        ('Inter-Regular.ttf', 'OFL-Inter.txt'),
        ('Inter-Medium.ttf', 'OFL-Inter.txt'),
        ('Inter-SemiBold.ttf', 'OFL-Inter.txt'),
        ('NotoSerif-Bold.ttf', 'OFL-NotoSerif.txt'),
        ('NotoSansSC-SemiBold.ttf', 'OFL-NotoSansSC.txt'),
        ('Inter-Bold.ttf', 'OFL-Inter.txt'),
    ]:
        path = 'assets/fonts/' + font
        assert path in members, f'Required bundled font missing: {font}'
        font_data = archive.read(path)
        assert font_data[:4] in {b'OTTO', b'\x00\x01\x00\x00'}
        table_count = int.from_bytes(font_data[4:6], 'big')
        assert len(font_data) >= 12 + 16 * table_count
        table_tags = {font_data[12 + 16 * index : 16 + 16 * index] for index in range(table_count)}
        assert b'cmap' in table_tags and b'name' in table_tags and b'fvar' not in table_tags
        assert archive.read('assets/fonts/' + license_name).strip(), 'Font license required'
print('APK 0.7.9, API 22, ARMv7, JNI, almanac, eleven bundled fonts/licenses, no Wi-Fi control checked')
