#!/usr/bin/env python3
"""Check native CI authority and test-driver CLI guards without starting services."""
import argparse
from pathlib import Path
import re
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]


def native_policy(text):
    if not re.search(r'permissions:\s*\n\s+contents: read', text):
        raise ValueError('native CI must use read-only repository permissions')
    for forbidden in ('id-token:', 'packages: write', 'contents: write', 'docker push',
                      'workflow_dispatches', 'GOOS=wasip1', 'buildmode=c-shared',
                      'environment: production'):
        if forbidden in text:
            raise ValueError('native CI gained forbidden authority or guest build')
    for required in ("go-version: '1.26.10'", 'GOTOOLCHAIN: local', "GOWORK: 'off'",
                     "CGO_ENABLED: '0'", 'go test -mod=readonly',
                     'go vet -mod=readonly', '-trimpath -buildvcs=false'):
        if required not in text:
            raise ValueError('native Go check missing: ' + required)


class StatusCI(unittest.TestCase):
    def test_actual_transport_and_pinned_source_are_mandatory(self):
        text = (ROOT / '.github/workflows/validate-bananapulse.yml').read_text()
        native = text.split('\n  native:', 1)[1]
        native_policy('permissions:\n  contents: read\n' + native)
        for value in ('status/.github/native-owner.commit', "r'[0-9a-f]{40}'",
                      'repository: BananaLabs-OSS/Bananapulse',
                      'ref: ${{ steps.owner.outputs.commit }}',
                      "node-version: '22.22.2'", 'npm run build',
                      'python3 scripts/test-native-subscription-http.py',
                      'python3 scripts/test-native-owner-http.py',
                      'python3 scripts/test-native-manual-orchestration-http.py',
                      "STATUS_DELIVERY_ENABLED: 'false'"):
            self.assertIn(value, native)
        self.assertNotIn('continue-on-error:', native)
        self.assertNotRegex(native, r'ref:\s*(?:main|master|HEAD)\s*(?:\n|$)')

    def test_required_current_inputs_are_checked(self):
        command = [sys.executable, str(ROOT / 'scripts/test-native-owner-http.py'),
                   '--app', '/tmp']
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn('--owner', result.stderr)

    def test_current_gate_rejects_historical_backend_inputs(self):
        command = [sys.executable, str(ROOT / 'scripts/test-native-owner-http.py'),
                   '--app', '/tmp', '--owner', '/tmp',
                   '--reference-app', '/tmp']
        result = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn('unrecognized arguments', result.stderr)

    def test_help_exposes_only_current_service_inputs(self):
        result = subprocess.run([sys.executable, str(ROOT / 'scripts/test-native-owner-http.py'),
                                 '--help'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0)
        self.assertIn('--owner', result.stdout)
        self.assertNotIn('--reference', result.stdout)


class GoWorkflow(unittest.TestCase):
    workflow = None
    monitor = False

    def runTest(self):
        text = self.workflow.read_text()
        native_policy(text)
        self.assertIn('pull_request:', text)
        self.assertIn('push:', text)
        self.assertIn('persist-credentials: false', text)
        if self.monitor:
            self.assertIn('go test -mod=readonly -race -count=1 ./internal/monitor', text)
            self.assertIn("STATUS_DELIVERY_ENABLED: 'false'", text)
        for mutation in ('id-token: write', 'docker push fixture', 'GOOS=wasip1'):
            with self.assertRaises(ValueError):
                native_policy(text + '\n' + mutation)
        with self.assertRaises(ValueError):
            native_policy(text.replace('go test -mod=readonly', 'echo test-removed'))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--owner-workflow', type=Path)
    parser.add_argument('--hytale-workflow', type=Path)
    args = parser.parse_args()
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(StatusCI)
    for path, monitor in ((args.owner_workflow, True), (args.hytale_workflow, False)):
        if path is not None:
            case = GoWorkflow()
            case.workflow = path
            case.monitor = monitor
            suite.addTest(case)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(0 if result.wasSuccessful() else 1)
