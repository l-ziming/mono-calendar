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
version=C509.p2-rp1fix8
fix1_mlan=d6272d7006a11abe37f0cd2dfdacd9cfd1207a9b431270370fd361f89d4b8009
fix1_sd=be5c9c74796495a23919c5ee0f29a077ab16d0113362055faaecf6689c96e445
previous_version=C509.p2-rp1fix3
previous_mlan=47381ea424f8da2e73a9dd8e00f3d0bbb9f2e92a6547e15d6d4db7d21d513271
previous_sd=a57bc1dcc98b6d2aec0030777fe2a3b633736dab5551cf630237cded32a46aa0
fix4_mlan=64007d57a4c129aeabcd2a7e03bbe3854dc3d8ea672ffc3dcaece3642a0e5670
fix4_sd=d1a2acc5279f66e29d863b10a1e5333e566e1cb0e550e0617920b19715134c6d
fix5_mlan=c5ff1a19b8a30311641e130b2c8cff44c38653a6cacc30f5ca5b6619df465df1
fix5_sd=28a2db12a1787143938f2f2b24d801efae5171c657468ec716aa3377c3258cfa
fix6_mlan=28c4003df76fef07fa5e2f7a2b22731a0109890d5a2a47e47ac41c8c800125f4
fix6_sd=21b83ee65baf6ba674a055e4456ff93caf72e0bff425a94a346d4e0ef18fa226
fix7_mlan=62a027b63924daba95b1731826c2b367dc9d40149a2dae49b3864fb187409e72
fix7_sd=8e63c529f3460d0a0659b89ae7f1e22f108ee849af90bcd85a188cbd7fc57964
patched_mlan=2f46329c4c4aec1ec831662b1a18fc10466579f013ae15bbebe0b77af722ba3b
patched_sd=153dc65d8079bbdf602fd184af2a8914cf09edd54b8ae84869ae0ee1b7c7c6e4
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
    case "$marker_version" in
        "$version") target_mlan=$patched_mlan; target_sd=$patched_sd ;;
        C509.p2-rp1fix1) target_mlan=$fix1_mlan; target_sd=$fix1_sd ;;
        "$previous_version") target_mlan=$previous_mlan; target_sd=$previous_sd ;;
        C509.p2-rp1fix4) target_mlan=$fix4_mlan; target_sd=$fix4_sd ;;
        C509.p2-rp1fix5) target_mlan=$fix5_mlan; target_sd=$fix5_sd ;;
        C509.p2-rp1fix6) target_mlan=$fix6_mlan; target_sd=$fix6_sd ;;
        C509.p2-rp1fix7) target_mlan=$fix7_mlan; target_sd=$fix7_sd ;;
        *) fail "Unknown module version: $target" ;;
    esac
    check_hash "$target/mlan8897.ko" "$target_mlan"
    check_hash "$target/sd8897.ko" "$target_sd"
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
    if [ "$stage_owned" = 1 ] && [ "$result" != 0 ] && [ -d "$stage/old" ]; then
        # A signal may arrive immediately after either directory rename.
        if [ ! -e "$stage/new" ] && [ ! -L "$stage/new" ] && [ -d "$target" ] && [ ! -L "$target" ]; then
            "$busybox" mv "$target" "$stage/new"
        fi
        if [ ! -e "$target" ] && [ ! -L "$target" ]; then
            "$busybox" mv "$stage/old" "$target"
        fi
        if [ -e "$stage/old" ]; then
            echo "Could not restore previous modules; preserved at: $stage/old" >&2
            stage_owned=0
            result=1
        fi
    fi
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
if { [ "$action" = install ] && [ -d "$target" ] && [ "$marker_version" = "$version" ]; } \
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
    new=$stage/new
    "$busybox" mkdir "$new"
    "$busybox" chmod 755 "$new"
    "$busybox" cp "$base/patched/mlan8897.ko" "$new/mlan8897.ko"
    "$busybox" cp "$base/patched/sd8897.ko" "$new/sd8897.ko"
    echo "$version" > "$new/.mono-calendar-version"
    "$busybox" chmod 644 "$new/mlan8897.ko" "$new/sd8897.ko" "$new/.mono-calendar-version"
    check_hash "$new/mlan8897.ko" "$patched_mlan"
    check_hash "$new/sd8897.ko" "$patched_sd"
    "$restorecon" -R "$new"
    check_target
    if [ -d "$target" ]; then
        "$busybox" mv "$target" "$stage/old"
    fi
    [ ! -e "$target" ] && [ ! -L "$target" ] || fail 'Module target appeared during installation'
    "$busybox" mv "$new" "$target"
else
    check_target
    "$busybox" mv "$target" "$stage/modules"
fi
"$busybox" sync
