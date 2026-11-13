# Host regression checks

Run `python3 tests/source/run.py` from this package, or invoke this file's sibling `run.py` by absolute path.

The extractor reads the current source bodies for `woal_fill_wait_queue`, `woal_wait_ioctl_complete`, `moal_ioctl_complete`, `woal_get_wakeup_reason`, and the complete `woal_cfg80211_resume`, plus the actual `RP1_DIAG` macro. Tests never copy or mirror their logic. Only the getter's extracted name changes so a wrapper can verify that resume passes initialized output.

C stubs model kernel waiting and locks with deterministic callback interleavings. ASan verifies request/wait/pbuf lifetime when late completion frees immediately after timeout detach, and when the waiting owner frees immediately after completion unlock. Tests also cover the opposite completion/timeout ordering, normal WAIT on CMD_TIMEOUT, error/PENDING/ENOMEM cleanup, successful reports, and diagnostic off. Four temporary mutations demonstrate that the checks detect the original missing wake, a newly introduced post-detach UAF, missing resume cleanup, and a broken diagnostic switch. Mutations affect temporary generated copies only.

ASan and UBSan run on the host. macOS does not support LSan here; explicit allocation accounting verifies no leaked or double-freed test allocations. This is not a test of ARM ABI, kernel scheduling, firmware, actual elapsed time, module loading, or physical power-state recovery. Factory logging is stubbed and counted separately from custom diagnostic printk output.

`generated/source_hashes.json` binds each run to the driver inputs. `last-run.txt` records the last successful check output.
