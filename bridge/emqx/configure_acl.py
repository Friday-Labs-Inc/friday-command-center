#!/usr/bin/env python3
"""Load the FCC topic ACL into EMQX and set authorization.no_match = deny.

Run after the broker is up (EMQX 5 dashboard API). Default dashboard creds are
admin/public — CHANGE THESE IN PRODUCTION.

    python configure_acl.py [http://127.0.0.1:18083]
"""

import os
import sys

import requests

EMQX = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:18083"
ACL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "acl.conf")
USER = os.environ.get("EMQX_DASH_USER", "admin")
PWORD = os.environ.get("EMQX_DASH_PASS", "public")


def main() -> int:
    token = requests.post(
        f"{EMQX}/api/v5/login", json={"username": USER, "password": PWORD}
    ).json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Load our rules into the built-in file authorizer.
    rules = open(ACL).read()
    requests.put(
        f"{EMQX}/api/v5/authorization/sources/file",
        headers=headers, json={"type": "file", "enable": True, "rules": rules},
    ).raise_for_status()

    # Flip the global default to deny (anything not explicitly allowed is rejected).
    settings = requests.get(
        f"{EMQX}/api/v5/authorization/settings", headers=headers
    ).json()
    settings["no_match"] = "deny"
    requests.put(
        f"{EMQX}/api/v5/authorization/settings", headers=headers, json=settings
    ).raise_for_status()

    print("ACL loaded into EMQX file authorizer; authorization.no_match = deny")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
