"""
Process manager and lifecycle coordinator for Dakini AI ICP Scraper.
Coordinates starting, stopping, health monitoring, and graceful termination
of the Node.js scraper alongside Master Database.
"""
import atexit
import json
import os
import signal
import subprocess
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

DAKINI_DIR = Path(__file__).resolve().parent.parent / "Dakini_AI-icp-scraper-main_parameters" / "Dakini_AI-icp-scraper-main"
PID_FILE = Path(__file__).resolve().parent.parent / "data" / ".dakini_scraper.pid"


class ScraperManager:
    """
    Manages the lifecycle of the Dakini AI scraper process,
    ensuring tight coordination with the Master Database.
    """

    def __init__(self, dakini_dir: Optional[Path] = None):
        self.dakini_dir = dakini_dir or DAKINI_DIR
        self._proc: Optional[subprocess.Popen] = None
        # Register exit handler to ensure child processes are terminated on parent shutdown
        atexit.register(self.stop)

    def _read_stored_pid(self) -> Optional[int]:
        if PID_FILE.exists():
            try:
                pid = int(PID_FILE.read_text(encoding="utf-8").strip())
                return pid
            except Exception:
                pass
        return None

    def _write_pid(self, pid: int):
        PID_FILE.parent.mkdir(parents=True, exist_ok=True)
        PID_FILE.write_text(str(pid), encoding="utf-8")

    def _clear_pid(self):
        PID_FILE.unlink(missing_ok=True)

    def is_running(self) -> bool:
        """Check if Dakini scraper is currently active and responding on port 3000."""
        # 1. Health check via HTTP port 3000
        try:
            req = urllib.request.Request("http://127.0.0.1:3000/api/health", headers={"User-Agent": "MasterDB/1.0"})
            with urllib.request.urlopen(req, timeout=1.0) as res:
                if res.status == 200:
                    return True
        except Exception:
            pass

        # 2. Check if tracked subprocess or PID is still running
        pid = self._proc.pid if self._proc and self._proc.poll() is None else self._read_stored_pid()
        if pid:
            try:
                output = subprocess.check_output(
                    f'tasklist /FI "PID eq {pid}" /NH',
                    shell=True,
                    stderr=subprocess.DEVNULL,
                    text=True,
                )
                if str(pid) in output:
                    return True
            except Exception:
                pass

        return False

    def get_status(self) -> Dict[str, Any]:
        """Get status metadata of Dakini scraper."""
        running = self.is_running()
        health_data = {}
        if running:
            try:
                req = urllib.request.Request("http://127.0.0.1:3000/api/health", headers={"User-Agent": "MasterDB/1.0"})
                with urllib.request.urlopen(req, timeout=1.0) as res:
                    health_data = json.loads(res.read().decode("utf-8"))
            except Exception:
                pass

        pid = self._proc.pid if self._proc and self._proc.poll() is None else self._read_stored_pid()
        return {
            "running": running,
            "pid": pid if running else None,
            "port": 3000,
            "url": "http://localhost:3000",
            "health": health_data,
        }

    def start(self, live_mode: bool = False) -> Tuple[bool, str]:
        """
        Start the Dakini AI scraper in the background and track its process.
        """
        if self.is_running():
            return True, "Dakini AI scraper is already running on http://localhost:3000."

        if not (self.dakini_dir / "server.js").exists():
            return False, f"server.js not found in: {self.dakini_dir}"

        env = os.environ.copy()
        env["PORT"] = "3000"
        env["DEMO_MODE"] = "false" if live_mode else "true"
        env["HOST"] = "127.0.0.1"

        try:
            creation_flags = 0
            if os.name == "nt":
                creation_flags = subprocess.CREATE_NEW_PROCESS_GROUP

            self._proc = subprocess.Popen(
                ["node", "server.js"],
                cwd=str(self.dakini_dir),
                env=env,
                creationflags=creation_flags,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )

            self._write_pid(self._proc.pid)

            for _ in range(10):
                time.sleep(0.5)
                if self.is_running():
                    mode_str = "Live Discovery Mode" if live_mode else "Demo Mode"
                    return True, f"Dakini AI scraper started successfully ({mode_str}, PID: {self._proc.pid}) at http://localhost:3000."

            return True, f"Dakini scraper process launched (PID: {self._proc.pid}). Starting up..."
        except Exception as ex:
            return False, f"Failed to start Dakini scraper: {str(ex)}"

    def stop(self) -> Tuple[bool, str]:
        """
        Stop the Dakini AI scraper cleanly.
        """
        killed = False
        if self._proc and self._proc.poll() is None:
            try:
                self._proc.terminate()
                self._proc.wait(timeout=2)
                killed = True
            except Exception:
                try:
                    self._proc.kill()
                    killed = True
                except Exception:
                    pass
            self._proc = None

        stored_pid = self._read_stored_pid()
        if stored_pid:
            try:
                if os.name == "nt":
                    subprocess.run(
                        f"taskkill /F /T /PID {stored_pid}",
                        shell=True,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                else:
                    os.kill(stored_pid, signal.SIGTERM)
                killed = True
            except Exception:
                pass
            self._clear_pid()

        if os.name == "nt" and self.is_running():
            try:
                res = subprocess.check_output(
                    'netstat -ano | findstr :3000 | findstr LISTENING',
                    shell=True,
                    text=True,
                    stderr=subprocess.DEVNULL,
                )
                for line in res.strip().splitlines():
                    parts = line.strip().split()
                    if parts:
                        p3000_pid = parts[-1]
                        subprocess.run(f"taskkill /F /PID {p3000_pid}", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                        killed = True
            except Exception:
                pass

        if killed or not self.is_running():
            return True, "Dakini AI scraper stopped successfully."
        return False, "Could not verify that the scraper process terminated."


# Global singleton instance
scraper_manager = ScraperManager()

