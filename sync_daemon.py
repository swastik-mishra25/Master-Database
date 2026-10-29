"""
Dakini AI ICP Scraper -> Master.xlsx Dynamic Synchronization Daemon.
Monitors Dakini SQLite database and CSVs for newly discovered or updated leads
and automatically streams them into data/Master.xlsx in real-time.
"""
import argparse
import sys
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
import time
from datetime import datetime

from core.sync_engine import DakiniSyncEngine


def main():
    parser = argparse.ArgumentParser(description="Dakini AI -> Master.xlsx Dynamic Sync Daemon")
    parser.add_argument("--interval", type=int, default=15, help="Polling interval in seconds (default: 15)")
    parser.add_argument("--once", action="store_true", help="Run a single sync check and exit")
    parser.add_argument("--force", action="store_true", help="Force sync regardless of change hash")
    parser.add_argument("--min-score", type=int, default=None, help="Minimum Dakini ICP fit score filter (e.g. 90 or 45)")
    args = parser.parse_args()

    engine = DakiniSyncEngine()
    active_src = engine.get_active_source()

    print("=" * 65)
    print("🤖 DAKINI AI -> MASTER.XLSX DYNAMIC SYNC DAEMON")
    print("=" * 65)
    if active_src:
        print(f"📁 Active Source: {active_src.name}")
        print(f"   Path: {active_src}")
    else:
        print("⚠️ Warning: No Dakini database (.sqlite) or CSV dataset detected yet.")
        print("   Daemon will continue watching the workspace for when Dakini runs...")

    if args.once or args.force:
        print("\n⚡ Running one-time synchronization...")
        res = engine.sync_once(min_score=args.min_score, force=args.force)
        if res["success"]:
            if res.get("changed", True):
                print(f"✅ Synced! New leads added: {res['new_leads']} | Total Master rows: {res['total_master_rows']}")
                if res.get("backup_created"):
                    print(f"📦 Backup created: {res['backup_created']}")
            else:
                print(f"ℹ️ {res['message']} (Total Master rows: {res['total_master_rows']})")
        else:
            print(f"❌ Sync failed: {res.get('error')}")
        sys.exit(0)

    print(f"\n👀 Watching for lead changes every {args.interval}s...")
    print("   Press Ctrl+C to stop.\n")

    # Initial sync check
    initial_res = engine.sync_once(min_score=args.min_score)
    if initial_res.get("changed"):
        print(f"[{datetime.now().strftime('%H:%M:%S')}] Initial Sync: +{initial_res['new_leads']} leads added. Total Master: {initial_res['total_master_rows']}")

    try:
        while True:
            time.sleep(args.interval)
            changed, src, _ = engine.has_changes()
            if changed and src:
                timestamp = datetime.now().strftime("%H:%M:%S")
                print(f"[{timestamp}] 🔔 Change detected in {src.name}! Syncing to Master.xlsx...")
                res = engine.sync_once(min_score=args.min_score)
                if res["success"]:
                    print(f"[{timestamp}] ✅ Update Complete: +{res['new_leads']} new leads, {res['duplicates_merged']} merged. Total Master rows: {res['total_master_rows']:,}")
                else:
                    print(f"[{timestamp}] ❌ Error during sync: {res.get('error')}")
    except KeyboardInterrupt:
        print("\n🛑 Sync daemon stopped by user.")


if __name__ == "__main__":
    main()
