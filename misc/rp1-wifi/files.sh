#!/system/bin/sh
set -eu

busybox=/system/bin/busybox
restorecon=/system/bin/restorecon
system=/system
block=/dev/block/mmcblk0p9
mounts=/proc/mounts
base=$(cd "$("$busybox" dirname "$0")" && pwd)
target=$system/lib/modules
stage=$system/lib/.mono-calendar-wifi.$$
version=C509.p2-rp1fix1
patched_mlan=d6272d7006a11abe37f0cd2dfdacd9cfd1207a9b431270370fd361f89d4b8009
patched_sd=be5c9c74796495a23919c5ee0f29a077ab16d0113362055faaecf6689c96e445
original_mlan=d84cee773f51eaad70c8743f9ad5402e3ff0638e3b418a4263766c7a546002e4
original_sd=02749c69bb603e0b3c1518014ff02d03e9e78fe6818b2b814db35318abacd8f7
stage_owned=0
restore_needed=0
success=

fail() {
    echo "$*" >&2
    exit 1
}

mount_mode() {
    "$busybox" awk -v path="$system" '
        $2 == path {
            count = split($4, flags, ",")
            for (i = 1; i <= count; i++)
                if (flags[i] == "ro" || flags[i] == "rw") {
                    print flags[i]
                    found = 1
                    exit
                }
        }
        END { if (!found) exit 1 }
    ' "$mounts"
}

check_hash() {
    [ ! -L "$1" ] && [ -f "$1" ] || fail "Expected a regular module file: $1"
    checksum=$("$busybox" sha256sum "$1") || fail "Could not hash: $1"
    [ "${checksum%% *}" = "$2" ] || fail "Module hash mismatch: $1"
}

check_target() {
    [ ! -L "$target" ] || fail "Refusing a symbolic link: $target"
    if [ ! -e "$target" ]; then
        return
    fi
    [ -d "$target" ] || fail "Unknown module path: $target"
    marker=$target/.mono-calendar-version
    [ ! -L "$marker" ] && [ -f "$marker" ] || fail "Unknown module directory: $target"
    marker_version=$("$busybox" cat "$marker") || fail "Could not read module marker: $target"
    [ "$marker_version" = "$version" ] || fail "Unknown module version: $target"
    check_hash "$target/mlan8897.ko" "$patched_mlan"
    check_hash "$target/sd8897.ko" "$patched_sd"
    for entry in "$target"/* "$target"/.[!.]* "$target"/..?*; do
        [ -e "$entry" ] || [ -L "$entry" ] || continue
        case "$entry" in
            "$marker"|"$target/mlan8897.ko"|"$target/sd8897.ko") ;;
            *) fail "Unexpected file in module directory: $entry" ;;
        esac
    done
}

cleanup() {
    result=$1
    trap - 0 1 2 15
    set +e
    if [ "$stage_owned" = 1 ]; then
        "$busybox" rm -rf "$stage"
        if [ "$?" != 0 ]; then
            echo "Could not remove staging directory: $stage" >&2
            result=1
        fi
    fi
    if [ "$restore_needed" = 1 ]; then
        "$busybox" mount -o "remount,$old_mount" "$block" "$system"
        if [ "$?" != 0 ]; then
            echo "Could not restore /system mount mode: $old_mount" >&2
            result=1
        fi
        if [ "$old_block" = 1 ]; then
            "$busybox" blockdev --setro "$block"
        else
            "$busybox" blockdev --setrw "$block"
        fi
        if [ "$?" != 0 ]; then
            echo "Could not restore system block read-only flag: $old_block" >&2
            result=1
        fi
        current_mount=$(mount_mode)
        current_block=$("$busybox" blockdev --getro "$block")
        if [ "$current_mount" != "$old_mount" ] || [ "$current_block" != "$old_block" ]; then
            echo 'System storage flags were not restored' >&2
            result=1
        fi
    fi
    # Report success only after storage flags have been restored.
    if [ "$result" = 0 ] && [ -n "$success" ]; then
        echo "$success"
    fi
    exit "$result"
}

[ "$#" = 1 ] || fail 'Usage: files.sh install|rollback|status'
action=$1
case "$action" in
    install|rollback|status) ;;
    *) fail 'Usage: files.sh install|rollback|status' ;;
esac
[ ! -L "$system" ] && [ ! -L "$system/lib" ] && [ -d "$system/lib" ] \
    || fail 'Expected a regular /system/lib directory'
check_target

if [ "$action" = status ]; then
    if [ -d "$target" ]; then
        echo 'RP1_WIFI_FILES_STATUS=installed'
    else
        echo 'RP1_WIFI_FILES_STATUS=absent'
    fi
    exit 0
fi

if [ "$action" = install ]; then
    [ ! -L "$base/original" ] && [ ! -L "$base/patched" ] \
        || fail 'Module source directories must not be symbolic links'
    check_hash "$base/original/mlan8897.ko" "$original_mlan"
    check_hash "$base/original/sd8897.ko" "$original_sd"
    check_hash "$base/patched/mlan8897.ko" "$patched_mlan"
    check_hash "$base/patched/sd8897.ko" "$patched_sd"
    success=RP1_WIFI_FILES_INSTALLED
else
    success=RP1_WIFI_FILES_ROLLED_BACK
fi

trap 'cleanup $?' 0
trap 'exit 129' 1
trap 'exit 130' 2
trap 'exit 143' 15
if { [ "$action" = install ] && [ -d "$target" ]; } \
    || { [ "$action" = rollback ] && [ ! -e "$target" ]; }; then
    exit 0
fi

old_mount=$(mount_mode) || fail 'Could not read /system mount mode'
old_block=$("$busybox" blockdev --getro "$block") || fail 'Could not read system block read-only flag'
case "$old_mount:$old_block" in
    ro:0|ro:1|rw:0|rw:1) ;;
    *) fail 'Unexpected system storage flags' ;;
esac
restore_needed=1
"$busybox" blockdev --setrw "$block" || fail 'Could not make system block writable'
"$busybox" mount -o remount,rw "$block" "$system" || fail 'Could not remount /system writable'
"$busybox" mkdir "$stage" || fail 'Could not create staging directory'
stage_owned=1
"$busybox" chmod 755 "$stage"

if [ "$action" = install ]; then
    "$busybox" cp "$base/patched/mlan8897.ko" "$stage/mlan8897.ko"
    "$busybox" cp "$base/patched/sd8897.ko" "$stage/sd8897.ko"
    echo "$version" > "$stage/.mono-calendar-version"
    "$busybox" chmod 644 "$stage/mlan8897.ko" "$stage/sd8897.ko" "$stage/.mono-calendar-version"
    check_hash "$stage/mlan8897.ko" "$patched_mlan"
    check_hash "$stage/sd8897.ko" "$patched_sd"
    "$restorecon" -R "$stage"
    [ ! -e "$target" ] && [ ! -L "$target" ] || fail 'Module target appeared during installation'
    "$busybox" mv "$stage" "$target"
    stage_owned=0
else
    check_target
    "$busybox" mv "$target" "$stage/modules"
fi
"$busybox" sync
