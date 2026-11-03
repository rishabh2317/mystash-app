#!/usr/bin/env python3
"""Manage the existing Mac development Analytics services; never builds or deploys code.

One reviewed preset enables capabilities, never user consent. Credentials remain
in the existing backend .env. Audit/plan are read-only; activate is explicit.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import plistlib
import re
import shlex
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT / 'backend/.analytics-release-private/pilot-20261028'
PRESET = ROOT / 'backend/config/analytics-pilot.json'
LABELS = {'api': 'in.mystash.api', 'worker': 'in.mystash.analytics'}
PG = Path('/opt/homebrew/opt/postgresql@17/bin/psql')


class PilotError(RuntimeError):
    pass


def load_preset(validate_client=True):
    preset = json.loads(PRESET.read_text())
    for role in ('api', 'worker', 'client'):
        if not preset[role] or any(v not in ('true', 'false') for v in preset[role].values()):
            raise PilotError('Invalid boolean preset')
    if preset['api']['ANALYTICS_ENABLED'] != preset['worker']['ANALYTICS_ENABLED']:
        raise PilotError('Collection and worker coverage configuration differ')
    if validate_client:
        eas = json.loads((ROOT / 'eas.json').read_text())
        if eas['build']['analytics-pilot']['env'] != preset['client']:
            raise PilotError('Pilot build and runtime preset differ')
    return preset


def disabled_flags(preset, feature=None):
    result = {role: dict(preset[role]) for role in ('api', 'worker')}
    groups = {
        'measurement': ('ANALYTICS_ENABLED', 'ANALYTICS_PERSONALIZATION_ENABLED', 'ANALYTICS_INTEREST_WORKER_ENABLED'),
        'personalization': ('ANALYTICS_PERSONALIZATION_ENABLED', 'ANALYTICS_INTEREST_WORKER_ENABLED'),
        'creator': ('ANALYTICS_CREATOR_REPORTING_ENABLED', 'ANALYTICS_ROLLUPS_ENABLED'),
        'admin': ('ANALYTICS_ADMIN_REPORTING_ENABLED', 'ANALYTICS_ADMIN_ROLLUPS_ENABLED'),
    }
    for role in result:
        keys = groups[feature] if feature else tuple(result[role])
        for key in keys:
            result[role][key] = 'false'
    # Privacy expiry/reconciliation must continue during every optional shutdown.
    result['worker']['ANALYTICS_MAINTENANCE_ENABLED'] = 'true'
    return result


def update_public_env(source, flags):
    lines = [line for line in source.splitlines() if not any(
        re.match(r'^\s*(?:export\s+)?' + re.escape(key) + r'\s*=', line) for key in flags)]
    return '\n'.join(lines).rstrip() + '\n' + '\n'.join(f'{key}={value}' for key, value in flags.items()) + '\n'


def private_json(name, value):
    PRIVATE.mkdir(parents=True, exist_ok=True); PRIVATE.chmod(0o700)
    path = PRIVATE / name
    path.write_text(json.dumps(value, indent=2)); path.chmod(0o600)


def services():
    result = {}
    for role, label in LABELS.items():
        path = Path.home() / 'Library/LaunchAgents' / (label + '.plist')
        if not path.is_file():
            raise PilotError('Expected existing local service is missing')
        value = plistlib.loads(path.read_bytes())
        args = value.get('ProgramArguments', [])
        suffix = '/index.js' if role == 'api' else '/analyticsWorker.js'
        entries = [Path(arg) for arg in args if arg.endswith(suffix)]
        if len(entries) != 1 or not entries[0].is_file() or '/Library/Application Support/Mystash/' not in str(entries[0]):
            raise PilotError('Unexpected immutable runtime; refusing to deploy or replace it')
        result[role] = {'path': path, 'value': value, 'entry': entries[0]}
    if result['api']['value']['WorkingDirectory'] != result['worker']['value']['WorkingDirectory']:
        raise PilotError('API and worker credential targets differ')
    # Confirm that the preserved artifacts contain the available feature code.
    for name in ('routes.js', 'creatorRoutes.js', 'adminRoutes.js', 'interestService.js'):
        if not (result['api']['entry'].parent / 'analytics' / name).is_file():
            raise PilotError('Deployed API lacks Analytics dependencies')
    if not (result['worker']['entry'].parent / 'analytics/worker.js').is_file():
        raise PilotError('Deployed worker lacks Analytics dependencies')
    return result


def connection(preset):
    linked = (ROOT / 'supabase/.temp/project-ref').read_text().strip()
    if linked != preset['project_ref']:
        raise PilotError('Unexpected linked database')
    cli = shutil.which('supabase') or '/opt/homebrew/bin/supabase'
    result = subprocess.run([cli, 'db', 'dump', '--linked', '--dry-run'], cwd=ROOT,
                            capture_output=True, text=True, timeout=90)
    if result.returncode:
        raise PilotError('Existing linked database connection unavailable; no credentials printed')
    values = {}
    for line in result.stdout.splitlines():
        if line.lstrip().startswith('export PG'):
            for token in shlex.split(line):
                if '=' in token:
                    key, value = token.split('=', 1)
                    if key.startswith('PG'):
                        values[key] = value
    if not all(values.get(k) for k in ('PGHOST', 'PGUSER', 'PGPASSWORD', 'PGDATABASE')):
        raise PilotError('Unexpected connection format')
    if linked not in values['PGHOST'] and linked not in values['PGUSER']:
        raise PilotError('Database target mismatch')
    return {**{k: v for k, v in os.environ.items() if not k.startswith('PG')}, **values,
            'PGSSLMODE': 'require', 'PGCONNECT_TIMEOUT': '15'}


def sql(env, query, variables=None):
    args = [str(PG), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1']
    for key, value in (variables or {}).items():
        args += ['-v', f'{key}={value}']
    result = subprocess.run(args, input=query, capture_output=True, text=True, env=env, timeout=45)
    if result.returncode:
        # SQL may contain an account identifier, so retain diagnostics privately.
        private_json('last-database-error.json', {'detail': result.stderr})
        raise PilotError('Database check failed; private diagnostic retained')
    return json.loads(result.stdout.strip()) if result.stdout.strip() else None


def audit(preset, env, test_email, admin_email):
    result = sql(env, (ROOT / 'backend/scripts/sql/analytics_pilot_preflight.sql').read_text(),
                 {'test_email': test_email, 'admin_email': admin_email})
    private_json('preflight.json', result)
    accounts = result['accounts']
    if test_email.lower() == admin_email.lower() or set(accounts) != {'test', 'admin'}:
        raise PilotError('Both distinct authorized accounts must already exist')
    for account in accounts.values():
        if not account['verified'] or not account['profile_exists'] or account['deleted'] or account['account_status'] != 'ACTIVE':
            raise PilotError('Authorized accounts must be verified and active')
    if accounts['test']['creator_status'] != 'ACTIVE':
        raise PilotError('The test account must already be an active creator')
    versions = {str(20261027120000 + i * 10000) for i in range(6)}
    if not versions.issubset(result['migration_versions']) or not all(result['functions'].values()) or not result['private_table_grants_safe'] or not result['private_tables_rls_enabled'] or not result['worker_rpc_timeouts_safe']:
        raise PilotError('Deployed Analytics dependencies or privacy grants are incomplete')
    if result['preflight']['blocking_drift']:
        raise PilotError('Counter drift requires separate review')
    if set(result['admin_members']) - {accounts['admin']['id']}:
        raise PilotError('Unexpected active admin membership; no access was changed')
    return result


def http(url, *, method='GET', body=None, headers=None):
    headers = {'User-Agent': 'MystashAnalyticsPilot/1.0', **(headers or {})}
    if body is not None:
        headers['Content-Type'] = 'application/json'
    request = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                                     method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read() or 'null')
    except urllib.error.HTTPError as error:
        try:
            data = json.loads(error.read())
        except (ValueError, UnicodeError):
            data = None
        return error.code, data


def write_plist(path, value):
    # Atomic replacement in the original service directory, preserving all fields.
    descriptor, temporary = tempfile.mkstemp(prefix='.mystash-pilot-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'wb') as stream:
            stream.write(plistlib.dumps(value))
        os.chmod(temporary, 0o600); os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def restart(configs, flags, preset, rollback=True):
    domain = f'gui/{os.getuid()}'
    before = {role: item['value'] for role, item in configs.items()}
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f')
    private_json('service-flags-before-' + stamp + '.json', {r: v.get('EnvironmentVariables', {}) for r, v in before.items()})
    # The original paths, credentials, ports and ingestion settings are retained.
    def stop():
        for role in ('worker', 'api'):
            label = LABELS[role]
            state = subprocess.run(['launchctl', 'print', domain + '/' + label], capture_output=True, text=True)
            if state.returncode == 0:
                match = re.search(r'\bpid = (\d+)', state.stdout)
                result = subprocess.run(['launchctl', 'bootout', domain + '/' + label], capture_output=True)
                if result.returncode:
                    raise PilotError('Could not drain the existing local Analytics service')
                if match:
                    for _ in range(40):
                        try:
                            os.kill(int(match.group(1)), 0)
                        except ProcessLookupError:
                            break
                        time.sleep(0.5)
                    else:
                        raise PilotError('Old service did not drain; no forced termination attempted')
        time.sleep(1)

    def start():
        for role in ('api', 'worker'):
            result = subprocess.run(['launchctl', 'bootstrap', domain, str(configs[role]['path'])], capture_output=True)
            if result.returncode:
                raise PilotError('Could not restart the existing local Analytics service')
        for _ in range(30):
            try:
                code, _ = http('http://127.0.0.1:8787/health')
                if code == 200:
                    break
            except (OSError, ValueError):
                pass
            time.sleep(0.5)
        else:
            raise PilotError('API did not become healthy')
        for role in configs:
            check = subprocess.run(['launchctl', 'print', domain + '/' + LABELS[role]], capture_output=True, text=True)
            if check.returncode or not re.search(r'\bpid = \d+', check.stdout):
                raise PilotError('Expected local service is not running')
        code, body = http('http://127.0.0.1:8787/analytics/config')
        if code != 200 or body.get('enabled') != (flags['api']['ANALYTICS_ENABLED'] == 'true'):
            raise PilotError('Runtime flag verification failed')

    try:
        stop()
        for role, item in configs.items():
            updated = {**before[role], 'EnvironmentVariables': {**before[role].get('EnvironmentVariables', {}), **flags[role]}}
            write_plist(item['path'], updated)
        start()
    except Exception:
        if not rollback:
            # An emergency/independent disable must never restore enabled flags
            # merely because a later health check or process restart failed.
            for role, item in configs.items():
                write_plist(item['path'], {**before[role], 'EnvironmentVariables': {
                    **before[role].get('EnvironmentVariables', {}), **flags[role]}})
            raise PilotError('Disabled flags are saved; service restart/drain needs manual inspection. Enabled flags were not restored.')
        try:
            stop()
        except PilotError:
            pass
        for role, item in configs.items():
            write_plist(item['path'], before[role])
        # Restore the prior files; avoid masking the original failure with a restart.
        for role in ('api', 'worker'):
            subprocess.run(['launchctl', 'bootstrap', domain, str(configs[role]['path'])], capture_output=True)
        raise


def credentials(configs, preset):
    env_path = Path(configs['api']['value']['WorkingDirectory']) / '.env'
    node = configs['api']['value']['ProgramArguments'][0]
    code = "const fs=require('fs'),d=require(process.argv[1]);const e=d.parse(fs.readFileSync(process.argv[2]));process.stdout.write(JSON.stringify({url:e.SUPABASE_URL,anon:e.SUPABASE_ANON_KEY,service:e.SUPABASE_SERVICE_ROLE_KEY}));"
    result = subprocess.run([node, '-e', code, str(ROOT / 'backend/node_modules/dotenv'), str(env_path)],
                            capture_output=True, text=True, timeout=10)
    if result.returncode:
        raise PilotError('Existing backend credentials unavailable')
    values = json.loads(result.stdout)
    if values.get('url') != 'https://' + preset['project_ref'] + '.supabase.co' or not values.get('anon') or not values.get('service'):
        raise PilotError('Credential target mismatch')
    return values


def validate(preset, configs, state):
    secret = credentials(configs, preset)
    results = {}
    for label, email in state['emails'].items():
        status, account = http(secret['url'] + '/auth/v1/admin/users/' + state['accounts'][label]['id'],
                               headers={'apikey': secret['service'], 'Authorization': 'Bearer ' + secret['service']})
        if status != 200 or account.get('email', '').lower() != email.lower() or not account.get('email_confirmed_at'):
            raise PilotError('Authorized account changed; no test session created')
        # Admin generate_link returns a link; it sends no email. Only these two
        # explicitly authorized, already-verified accounts may receive a test session.
        status, link = http(secret['url'] + '/auth/v1/admin/generate_link', method='POST', body={'type': 'magiclink', 'email': email},
                            headers={'apikey': secret['service'], 'Authorization': 'Bearer ' + secret['service']})
        if status != 200:
            raise PilotError('Authorized test-session creation failed')
        properties = link.get('properties', link)
        status, session = http(secret['url'] + '/auth/v1/verify', method='POST',
                               body={'type': 'magiclink', 'token_hash': properties.get('hashed_token')}, headers={'apikey': secret['anon']})
        if status != 200 or not session.get('access_token'):
            raise PilotError('Authorized test-session verification failed')
        token = session['access_token']
        headers = {'Authorization': 'Bearer ' + token}
        try:
            if session.get('user', {}).get('id') != state['accounts'][label]['id']:
                raise PilotError('Authorized test-session identity mismatch')
            own = {}
            measurement_opted_in = False
            for route in ('preferences', 'personalization', 'interests', 'creator?days=7', 'admin?days=7'):
                code, body = http(preset['api_url'] + '/analytics/' + route, headers=headers)
                expected = 403 if label == 'test' and route.startswith('admin?') else 200
                if code != expected:
                    raise PilotError(f'{label} {route.split("?")[0]} authorization/readiness check failed ({code})')
                own[route.split('?')[0]] = code
                if route == 'preferences':
                    measurement_opted_in = body.get('preferences', {}).get('measurement_enabled') is True
                    own['measurement_opted_in'] = measurement_opted_in
                    own['activity_opted_in'] = body.get('preferences', {}).get('activity_enabled') is True
                if route == 'personalization':
                    if not body.get('available'):
                        raise PilotError('Personalization capability is unavailable')
                    own['personalization_opted_in'] = body.get('preferences', {}).get('enabled') is True
            # A syntactically valid event without the account's consent revision
            # must be rejected, not silently enrolled or stored as activity.
            if not measurement_opted_in:
                session_id = str(uuid.uuid4())
                event = {'event_id': str(uuid.uuid4()), 'session_id': session_id, 'event_name': 'session.started',
                         'schema_version': 1, 'occurred_at': datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
                         'entity_type': 'app', 'surface': 'app', 'properties': {}, 'platform': 'android', 'app_version': '1.0.0'}
                code, body = http(preset['api_url'] + '/analytics/batch', method='POST', body={'events': [event]},
                                  headers={**headers, 'x-mystash-session': session_id, 'x-mystash-consent-revision': str(uuid.uuid4())})
                if code != 200 or not body.get('consent_rejected') or body.get('accepted'):
                    raise PilotError('Non-consenting account was not rejected')
                own['unconsented_batch_rejected'] = True
            else:
                own['synthetic_event_skipped'] = True
            results[label] = own
        finally:
            # Revoke only this test refresh session, preserving other devices.
            status, _ = http(secret['url'] + '/auth/v1/logout?scope=local', method='POST',
                             headers={'apikey': secret['anon'], 'Authorization': 'Bearer ' + token})
            if status not in (200, 204):
                raise PilotError('Test-session cleanup requires review')
    private_json('validation.json', results)
    return results


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('audit', 'plan', 'activate', 'status', 'validate', 'disable', 'shutdown'))
    parser.add_argument('--test-account')
    parser.add_argument('--admin-account')
    parser.add_argument('--feature', choices=('measurement', 'personalization', 'creator', 'admin'))
    args = parser.parse_args()
    preset = load_preset(validate_client=args.action not in ('shutdown', 'disable', 'status')); configs = services()
    if args.action == 'status':
        print(json.dumps({r: {k: c['value'].get('EnvironmentVariables', {}).get(k, 'false') for k in preset[r]}
                          for r, c in configs.items()}, indent=2)); return
    if args.action in ('disable', 'shutdown'):
        if args.action == 'disable' and not args.feature:
            raise PilotError('Select the independent feature to disable')
        current = {r: {k: c['value'].get('EnvironmentVariables', {}).get(k, 'false') for k in preset[r]}
                   for r, c in configs.items()}
        flags = disabled_flags(current, args.feature if args.action == 'disable' else None)
        restart(configs, flags, preset, rollback=False)
        print(json.dumps({'applied': args.action, 'feature': args.feature, 'flags': flags})); return
    if args.action == 'validate':
        print(json.dumps(validate(preset, configs, json.loads((PRIVATE / 'pilot-state.json').read_text())), indent=2)); return
    if not args.test_account or not args.admin_account:
        raise PilotError('Identify the explicitly authorized test and admin accounts')
    env = connection(preset)
    result = audit(preset, env, args.test_account, args.admin_account)
    if args.action in ('audit', 'plan'):
        print(json.dumps({'dependencies_ready': True, 'counter_initialization_needed': result['preflight'],
                          'existing_measurement_opt_ins': result['measurement_opt_ins'], 'existing_personalization_opt_ins': result['personalization_opt_ins'],
                          'account_roles_ready': True, 'preset': {r: preset[r] for r in ('api', 'worker', 'client')},
                          'apk_rebuild_required': True}, indent=2)); return
    # Activation never seeds a preference row or changes any user's consent.
    # Missing zero-drift projections use the already-deployed preserving initializer.
    if result['preflight']['missing_baselines'] or result['preflight']['missing_projections']:
        prepared = sql(env, """BEGIN; SET LOCAL ROLE postgres;
DO $$ DECLARE before_mirrors jsonb; after_mirrors jsonb; BEGIN
 SELECT jsonb_build_object('collections',(SELECT md5(string_agg(concat_ws(':',id,views_count,saves_count,shares_count,product_clicks_count),'|' ORDER BY id)) FROM public.collections),
  'users',(SELECT md5(string_agg(concat_ws(':',id,followers_count,following_count),'|' ORDER BY id)) FROM public.users)) INTO before_mirrors;
 PERFORM public.engagement_prepare_counter_baselines();
 SELECT jsonb_build_object('collections',(SELECT md5(string_agg(concat_ws(':',id,views_count,saves_count,shares_count,product_clicks_count),'|' ORDER BY id)) FROM public.collections),
  'users',(SELECT md5(string_agg(concat_ws(':',id,followers_count,following_count),'|' ORDER BY id)) FROM public.users)) INTO after_mirrors;
 IF before_mirrors IS DISTINCT FROM after_mirrors THEN RAISE EXCEPTION 'Business mirrors changed; rolled back'; END IF;
END $$;
SELECT public.engagement_counter_preflight(); COMMIT;""")
        if any(prepared.get(k) for k in ('blocking_drift', 'missing_baselines', 'missing_projections')):
            raise PilotError('Counter initialization incomplete')
    admin_id = result['accounts']['admin']['id']
    if not re.fullmatch(r'[0-9a-f-]{36}', admin_id):
        raise PilotError('Invalid verified account identity')
    grant = sql(env, """BEGIN; SET LOCAL ROLE postgres; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='20s';
LOCK TABLE public.analytics_admin_members IN SHARE ROW EXCLUSIVE MODE;
SET LOCAL mystash.pilot.admin = :'admin_id';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.analytics_admin_members WHERE enabled AND user_id<>current_setting('mystash.pilot.admin')::uuid)
 THEN RAISE EXCEPTION 'Unexpected admin membership'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.users u JOIN auth.users a ON a.id=u.id
  WHERE u.id=current_setting('mystash.pilot.admin')::uuid AND u.account_status='ACTIVE' AND u.deleted_at IS NULL AND a.email_confirmed_at IS NOT NULL)
 THEN RAISE EXCEPTION 'Authorized admin is no longer eligible'; END IF;
END $$;
INSERT INTO public.analytics_admin_members(user_id,enabled) VALUES(:'admin_id'::uuid,true)
ON CONFLICT(user_id) DO UPDATE SET enabled=true;
SELECT jsonb_build_object('authorized',public.analytics_admin_authorized(:'admin_id'::uuid)); COMMIT;""", {'admin_id': admin_id})
    if not grant.get('authorized'):
        raise PilotError('Admin authorization was not confirmed')
    try:
        restart(configs, {r: preset[r] for r in ('api', 'worker')}, preset)
    except Exception:
        if admin_id not in result['admin_members']:
            sql(env, "BEGIN; SET LOCAL ROLE postgres; DELETE FROM public.analytics_admin_members WHERE user_id=:'admin_id'::uuid; COMMIT;", {'admin_id': admin_id})
        raise
    local_env = ROOT / '.env.local'
    original = local_env.read_text() if local_env.exists() else ''
    updated = update_public_env(original, preset['client'])
    local_env.write_text(updated); local_env.chmod(0o600)
    state = {'accounts': result['accounts'], 'emails': {'test': args.test_account, 'admin': args.admin_account},
             'activated_at': datetime.now(timezone.utc).isoformat(), 'consent_modified': False}
    private_json('pilot-state.json', state)
    print(json.dumps({'activated': True, 'consent_modified': False, 'admin_membership_scoped': True,
                      'existing_runtime_paths_preserved': True, 'client_rebuild_required': True}))


if __name__ == '__main__':
    try:
        main()
    except PilotError as error:
        raise SystemExit(str(error))
