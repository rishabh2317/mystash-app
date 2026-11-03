#!/usr/bin/env python3
"""Offline preset/operator safety regressions. No credentials, services or network."""
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('pilot', Path(__file__).with_name('analyticsPilot.py'))
pilot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pilot)


class PilotTests(unittest.TestCase):
    def setUp(self):
        self.preset = pilot.load_preset()

    def test_api_and_worker_coverage_match_with_one_maintenance_owner(self):
        self.assertEqual(self.preset['api']['ANALYTICS_ENABLED'], 'true')
        self.assertEqual(self.preset['worker']['ANALYTICS_ENABLED'], 'true')
        self.assertEqual(self.preset['worker']['ANALYTICS_MAINTENANCE_ENABLED'], 'true')
        for key in ('ANALYTICS_MAINTENANCE_ENABLED', 'ANALYTICS_ROLLUPS_ENABLED', 'ANALYTICS_ADMIN_ROLLUPS_ENABLED', 'ANALYTICS_INTEREST_WORKER_ENABLED'):
            self.assertEqual(self.preset['api'][key], 'false')
            self.assertEqual(self.preset['worker'][key], 'true')

    def test_preset_enables_capabilities_and_contains_no_consent_or_identity(self):
        allowed = {'version', 'project_ref', 'api_url', 'api', 'worker', 'client'}
        self.assertEqual(set(self.preset), allowed)
        self.assertTrue(all(v == 'true' for v in self.preset['client'].values()))
        self.assertNotIn('user_id', str(self.preset))
        self.assertNotIn('measurement_enabled', str(self.preset))
        self.assertNotIn('@', str(self.preset))

    def test_personalization_shutdown_preserves_measurement_and_reports(self):
        flags = pilot.disabled_flags(self.preset, 'personalization')
        for role in flags:
            self.assertEqual(flags[role]['ANALYTICS_PERSONALIZATION_ENABLED'], 'false')
            self.assertEqual(flags[role]['ANALYTICS_INTEREST_WORKER_ENABLED'], 'false')
            self.assertEqual(flags[role]['ANALYTICS_ENABLED'], 'true')
        self.assertEqual(flags['api']['ANALYTICS_CREATOR_REPORTING_ENABLED'], 'true')
        self.assertEqual(flags['api']['ANALYTICS_ADMIN_REPORTING_ENABLED'], 'true')

    def test_measurement_shutdown_also_stops_profiling_but_preserves_reporting(self):
        flags = pilot.disabled_flags(self.preset, 'measurement')
        self.assertEqual(flags['worker']['ANALYTICS_ENABLED'], 'false')
        self.assertEqual(flags['worker']['ANALYTICS_INTEREST_WORKER_ENABLED'], 'false')
        self.assertEqual(flags['worker']['ANALYTICS_ROLLUPS_ENABLED'], 'true')
        self.assertEqual(flags['api']['ANALYTICS_ADMIN_REPORTING_ENABLED'], 'true')

    def test_admin_can_be_disabled_without_touching_creator_or_privacy(self):
        flags = pilot.disabled_flags(self.preset, 'admin')
        self.assertEqual(flags['api']['ANALYTICS_ADMIN_REPORTING_ENABLED'], 'false')
        self.assertEqual(flags['worker']['ANALYTICS_ADMIN_ROLLUPS_ENABLED'], 'false')
        self.assertEqual(flags['api']['ANALYTICS_CREATOR_REPORTING_ENABLED'], 'true')
        self.assertEqual(flags['worker']['ANALYTICS_MAINTENANCE_ENABLED'], 'true')

    def test_emergency_shutdown_preserves_privacy_maintenance_only(self):
        flags = pilot.disabled_flags(self.preset)
        self.assertEqual({k for role in flags.values() for k, v in role.items() if v == 'true'}, {'ANALYTICS_MAINTENANCE_ENABLED'})

    def test_disabling_one_feature_never_reenables_another(self):
        current = pilot.disabled_flags(self.preset, 'measurement')
        after = pilot.disabled_flags(current, 'admin')
        self.assertEqual(after['api']['ANALYTICS_ENABLED'], 'false')
        self.assertEqual(after['worker']['ANALYTICS_INTEREST_WORKER_ENABLED'], 'false')

    def test_local_client_flag_replacement_preserves_existing_values(self):
        source = '# fixture\nEXPO_PUBLIC_SUPABASE_ANON_KEY="fixture-keep-exact"\nEXPO_PUBLIC_ANALYTICS_ENABLED=false\n'
        updated = pilot.update_public_env(source, self.preset['client'])
        self.assertIn('EXPO_PUBLIC_SUPABASE_ANON_KEY="fixture-keep-exact"\n', updated)
        self.assertEqual(updated.count('EXPO_PUBLIC_ANALYTICS_ENABLED='), 1)
        self.assertEqual(pilot.update_public_env(updated, self.preset['client']), updated)

    def test_shutdown_works_without_a_database_or_credentials(self):
        configs = {r: {'value': {'EnvironmentVariables': self.preset[r]}} for r in ('api', 'worker')}
        with patch.object(sys, 'argv', ['pilot', 'shutdown']), patch.object(pilot, 'services', return_value=configs), \
             patch.object(pilot, 'restart') as restart, patch.object(pilot, 'connection', side_effect=AssertionError('DB forbidden')), \
             patch('builtins.print'):
            pilot.main()
        self.assertEqual(restart.call_args.args[1]['worker']['ANALYTICS_MAINTENANCE_ENABLED'], 'true')
        self.assertFalse(restart.call_args.kwargs['rollback'])

    def test_disable_failure_never_restores_enabled_flags(self):
        configs = {r: {'path': Path('/fixture/' + r), 'value': {'EnvironmentVariables': self.preset[r]}} for r in ('api', 'worker')}
        disabled = pilot.disabled_flags(self.preset)
        with patch.object(pilot, 'private_json'), patch.object(pilot, 'write_plist') as write, \
             patch.object(pilot.subprocess, 'run', return_value=SimpleNamespace(returncode=1, stdout='')), \
             patch.object(pilot.time, 'sleep'):
            with self.assertRaisesRegex(pilot.PilotError, 'Enabled flags were not restored'):
                pilot.restart(configs, disabled, self.preset, rollback=False)
        for call in write.call_args_list:
            self.assertEqual(call.args[1]['EnvironmentVariables']['ANALYTICS_ENABLED'], 'false')

    def test_emergency_control_does_not_depend_on_build_profile_consistency(self):
        import json
        original = json.loads
        def altered(source):
            result = original(source)
            if 'build' in result:
                result['build']['analytics-pilot']['env'] = {}
            return result
        with patch.object(pilot.json, 'loads', side_effect=altered):
            with self.assertRaises(pilot.PilotError):
                pilot.load_preset()
            self.assertEqual(pilot.load_preset(validate_client=False)['worker']['ANALYTICS_MAINTENANCE_ENABLED'], 'true')

    def test_activation_keeps_existing_build_profiles_and_identifiers(self):
        import json
        eas = json.loads((pilot.ROOT / 'eas.json').read_text())
        self.assertEqual(eas['build']['analytics-pilot']['extends'], 'preview')
        self.assertEqual(eas['build']['analytics-pilot']['environment'], 'preview')
        self.assertNotIn('EXPO_PUBLIC_ANALYTICS_ENABLED', eas['build']['production'].get('env', {}))
        self.assertNotIn('EXPO_PUBLIC_ANALYTICS_ENABLED', eas['build']['preview'].get('env', {}))
        self.assertNotIn('android', eas['build']['analytics-pilot'])
        self.assertNotIn('ios', eas['build']['analytics-pilot'])

    def validation_fixture(self, wrong_identity=False, consented=False):
        state = {'accounts': {'test': {'id': 'fixture-test'}, 'admin': {'id': 'fixture-admin'}},
                 'emails': {'test': 'test@fixture.invalid', 'admin': 'admin@fixture.invalid'}}
        calls = []
        current = 'test'
        def network(url, method='GET', body=None, headers=None):
            nonlocal current
            calls.append((url, method, body))
            if '/admin/users/' in url:
                role = 'test' if url.endswith('fixture-test') else 'admin'
                return 200, {'email': state['emails'][role], 'email_confirmed_at': 'fixture'}
            if url.endswith('/generate_link'):
                current = 'test' if body['email'] == state['emails']['test'] else 'admin'
                return 200, {'hashed_token': 'fixture'}
            if url.endswith('/verify'):
                return 200, {'access_token': 'fixture-session', 'user': {'id': 'wrong' if wrong_identity else state['accounts'][current]['id']}}
            if '/logout?scope=local' in url:
                return 204, None
            if url.endswith('/preferences'):
                return 200, {'preferences': {'measurement_enabled': consented, 'activity_enabled': consented}}
            if url.endswith('/personalization'):
                return 200, {'available': True, 'preferences': {'enabled': False}}
            if url.endswith('/interests') or '/creator?' in url:
                return 200, {}
            if '/admin?' in url:
                return (403 if current == 'test' else 200), {}
            if url.endswith('/batch'):
                return 200, {'consent_rejected': True, 'accepted': []}
            raise AssertionError('Unexpected request')
        return state, calls, network

    def test_validation_never_enrolls_accounts_or_injects_events_into_consented_accounts(self):
        for consented in (False, True):
            state, calls, network = self.validation_fixture(consented=consented)
            with patch.object(pilot, 'credentials', return_value={'url': 'https://fixture.invalid', 'service': 'fixture', 'anon': 'fixture'}), \
                 patch.object(pilot, 'private_json'), patch.object(pilot, 'http', side_effect=network):
                pilot.validate(self.preset, {}, state)
            self.assertFalse(any(method in ('PUT', 'DELETE') for _, method, _ in calls))
            self.assertEqual(sum('/logout?scope=local' in url for url, _, _ in calls), 2)
            self.assertEqual(sum(url.endswith('/batch') for url, _, _ in calls), 0 if consented else 2)

    def test_identity_mismatch_always_cleans_up_the_created_test_session(self):
        state, calls, network = self.validation_fixture(wrong_identity=True)
        with patch.object(pilot, 'credentials', return_value={'url': 'https://fixture.invalid', 'service': 'fixture', 'anon': 'fixture'}), \
             patch.object(pilot, 'private_json'), patch.object(pilot, 'http', side_effect=network):
            with self.assertRaisesRegex(pilot.PilotError, 'identity mismatch'):
                pilot.validate(self.preset, {}, state)
        self.assertEqual(sum('/logout?scope=local' in url for url, _, _ in calls), 1)
        self.assertFalse(any('/analytics/' in url for url, _, _ in calls))


if __name__ == '__main__':
    unittest.main()
