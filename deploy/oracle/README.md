# Running the collectors on a VM (Oracle Cloud Always Free)

GitHub Actions is fine for the 10-minute snapshot, but an always-on websocket
listener is ~750 runner-hours a month — a grey area under GitHub's fair-use terms.
This folder moves both collectors to a small VM; the site does not change, it
still reads the `data` branch.

## Oracle Cloud

1. Sign up at cloud.oracle.com (a card is required for identity, Always Free resources are never billed).
   Pick a home region close to you — it cannot be changed later.
2. **Upgrade the tenancy to Pay As You Go** (Billing → Upgrade). Always Free shapes stay free, but
   free-tier-only tenancies can have idle instances *reclaimed* after 7 days of low CPU/network — a
   quiet websocket listener looks idle. PAYG tenancies are not reclaimed.
3. Compute → Instances → Create instance:
   - Image: **Ubuntu 22.04 or 24.04** (Canonical)
   - Shape: **VM.Standard.E2.1.Micro** (Always Free eligible; Ampere A1 also works when capacity is available)
   - Networking: defaults (a public IP is fine; nothing listens inbound)
   - Add your SSH public key
4. `ssh ubuntu@<public-ip>` and run:

```bash
curl -fsSL https://raw.githubusercontent.com/eferbarn/PopDex_Minor_Insights/main/deploy/oracle/setup.sh | bash
```

It prints a deploy key; add it at *repo → Settings → Deploy keys → Add* with **Allow write access**,
press Enter, and it finishes: code in `/opt/popdex/code`, two clones of the `data` branch
(one per writer), and three systemd units:

| unit | what |
|---|---|
| `popdex-listener.service` | websocket listener, always on, restarts on failure, commits every 10 min |
| `popdex-snapshot.timer` | runs `snapshot.py` every 10 minutes |
| `popdex-update.timer` | hourly `git pull` of `main`; restarts the listener if the code changed |

## Then, on GitHub

Actions tab → `listener` → ⋯ → **Disable workflow**. Same for `snapshot`. (Re-enable them any time
the VM is down; both are also runnable manually.) With both disabled, GitHub usage drops to zero.

## Checks

```bash
systemctl status popdex-listener
journalctl -u popdex-listener -f
systemctl list-timers 'popdex-*'
```

Any other Ubuntu box (Hetzner, a Raspberry Pi at home) works the same way — the script only assumes
Ubuntu + systemd.
