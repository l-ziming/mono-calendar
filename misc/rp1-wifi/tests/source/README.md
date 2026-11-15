# Host regression checks

Run `python3 tests/source/run.py` from this package, or invoke this file's sibling `run.py` by absolute path.

The extractor reads the current source bodies for `woal_fill_wait_queue`, `woal_wait_ioctl_complete`, `moal_ioctl_complete`, `woal_get_wakeup_reason`, and the complete `woal_cfg80211_resume`, plus the actual `RP1_DIAG` macro. Tests never copy or mirror their logic. Only the getter's extracted name changes so a wrapper can verify that resume passes initialized output.

C stubs model kernel waiting and locks with deterministic callback interleavings. ASan verifies request/wait/pbuf lifetime when late completion frees immediately after timeout detach, and when the waiting owner frees immediately after completion unlock. Tests also cover the opposite completion/timeout ordering, normal WAIT on CMD_TIMEOUT, error/PENDING/ENOMEM cleanup, successful reports, and diagnostic off. Four temporary mutations demonstrate that the checks detect the original missing wake, a newly introduced post-detach UAF, missing resume cleanup, and a broken diagnostic switch. Mutations affect temporary generated copies only.

ASan and UBSan run on the host. macOS does not support LSan here; explicit allocation accounting verifies no leaked or double-freed test allocations. This is not a test of ARM ABI, kernel scheduling, firmware, actual elapsed time, module loading, or physical power-state recovery. Factory logging is stubbed and counted separately from custom diagnostic printk output.

`sleep_filter.py` compiles the actual sleep-MEF builder, programming function, worker and firmware-event callback from `moal_rp1_filter.h`. An independent postfix decoder evaluates byte matches and the zero-mask BIT_EQ catch-all using first-match order. The seven-entry, 356-byte result must match `whitelist-reference.entries.bin` byte for byte for IPv4 `192.168.100.135` and MAC `ac:89:95:f7:b3:15`. This small reference is the table used in the device whitelist checks, SHA-256 `602c9c234d1b002156821b3ac3e88a552f4a545640440dd517e6d72eeff83f0e`.

Two IPv4/MAC pairs exercise 26 allow/offload cases and 27 catch-all cases each: local ARP request/reply, ordinary local IPv4 including HA/DNS/NTP and fragments, client-qualified DHCP DF0/DF1, EAPOL, discovery noise, other clients, malformed/truncated DHCP and IPv6 outside the current policy. Every entry acts only in mode 1 and stays under the 100-byte expression limit. Tests also check stale address/MAC removal, all short output capacities, exact capacity, null inputs, actual firmware-command bytes, the current netdev MAC and PENDING ownership under ASan/UBSan. Worker checks retain dynamic-IP programming, force-rebuild after a MAC-change event, real cleanup when disabled, failure fallback/latch and deferred-event boundaries. Three temporary mutations verify that missing cleanup/fallback and premature PENDING frees are detected.

Source guards keep filter programming out of the suspend/resume functions and verify the separate freezable workqueue and unregister/cancel/free order. These guards and boundary stubs do not prove kernel race freedom or firmware filtering: module lifecycle, reconnect, firmware acceptance and physical standby still require device validation.

`generated/source_hashes.json` binds each run to the driver inputs. `last-run.txt` records the last successful check output.
