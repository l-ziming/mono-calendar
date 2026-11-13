#!/bin/bash
# Local macOS build; does not operate the RP1 or modify Sony kernel source.
set -euo pipefail
rp1_dir=$(cd "$(dirname "$0")" && pwd)
rp1_repo=$(cd "$rp1_dir/../.." && pwd)
rp1_build=${RP1_BUILD_DIR:-"$rp1_dir/.build/kernel"}
rp1_toolchain=${RP1_TOOLCHAIN_DIR:-"$rp1_dir/.build/aosp-gcc48"}
rp1_kernel=${RP1_KERNEL_SOURCE:-"$rp1_dir/../../../output/rp1-kernel-20261110-live/source/linux-3.14.35"}
rp1_driver="$rp1_dir/source/wlan_src"
rp1_url='https://android.googlesource.com/platform/prebuilts/gcc/darwin-x86/arm/arm-linux-androideabi-4.8/+archive/refs/tags/android-5.1.1_r38.tar.gz'
rp1_sha=263e726adf803ddccf55ced75df5e3af4c50ea4a86cf570e872217d395f27daa
if [[ ! -x "$rp1_toolchain/bin/arm-linux-androideabi-gcc" ]]; then
    mkdir -p "$rp1_toolchain"
    rp1_archive="$rp1_toolchain/../aosp-gcc48.tar.gz"
    curl -fL --retry 2 "$rp1_url" -o "$rp1_archive"
    printf '%s  %s\n' "$rp1_sha" "$rp1_archive" | shasum -a 256 -c -
    tar -xzf "$rp1_archive" -C "$rp1_toolchain"
fi
rp1_gcc="$rp1_toolchain/bin/arm-linux-androideabi-"
"${rp1_gcc}gcc" --version
mkdir -p "$rp1_build/hostinclude"
cp "$rp1_dir/build-support/hostinclude/elf.h" "$rp1_build/hostinclude/elf.h"
cp "$rp1_dir/build-support/kernel.config" "$rp1_build/.config"
rp1_make() {
    make -C "$rp1_kernel" O="$rp1_build" ARCH=arm \
      HOSTCC="clang -arch x86_64" HOSTCFLAGS="-O2 -I$rp1_build/hostinclude" \
      HOSTLDFLAGS="-Wl,-no_pie" CROSS_COMPILE="$rp1_gcc" \
      CC="${rp1_gcc}gcc -fno-pic -fno-pie" KCFLAGS="-fno-pic -fno-pie" \
      LD="${rp1_gcc}ld" AR="${rp1_gcc}ar" NM="${rp1_gcc}nm" \
      OBJCOPY="${rp1_gcc}objcopy" OBJDUMP="${rp1_gcc}objdump" STRIP="${rp1_gcc}strip" "$@"
}
rp1_make olddefconfig
cmp "$rp1_dir/build-support/kernel.config" "$rp1_build/.config"
rp1_make modules_prepare
rp1_make M="$rp1_driver" KERNELDIR="$rp1_build" modules "$@"
