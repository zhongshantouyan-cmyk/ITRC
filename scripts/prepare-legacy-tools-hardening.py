#!/usr/bin/env python3
"""Patch a downloaded static tool site without shipping personal/finance seed data.

Run on a verified complete copy of the existing site. No network access, credentials,
Firebase reads/writes, deployment, or Git operations are performed by this script.
The original directory is preserved; output must not already exist.
"""
import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path


def replace_once(text, pattern, replacement, label, flags=0):
    updated, count = re.subn(pattern, lambda _m: replacement, text, flags=flags)
    if count != 1:
        raise ValueError(f'{label}: expected one verified source match, found {count}; no deployment output produced')
    return updated


def patch_roster(text):
    text = replace_once(text, r'function seed\(\)\s*\{.*?\n\}',
                        'function seed(){ return []; }', 'roster seed', re.S)
    text = replace_once(text, r'var SHEET_CSV_URL\s*=.*?;',
                        "var SHEET_CSV_URL = ''; // Private roster: no anonymous CSV endpoint.", 'public CSV URL')
    text = text.replace('DATA=norm(s.val());if(!DATA.length){DATA=seed();rolesRef.set(DATA);}render();',
                        'DATA=norm(s.val());render();')
    replacement = """function importFromSheet(){
  if(!ITRCAuth.can('roster')){ alert('請使用有名單管理權限的帳號登入。'); return; }
  var box=document.querySelector('.importbox'); if(box)box.open=true;
  var msg=$('imp_msg'); if(msg)msg.textContent='請在已授權的名單試算表複製資料後貼上，或選取下載的 CSV，再檢查預覽。名單不必公開分享。';
  var input=$('imp_text'); if(input)input.focus();
}"""
    text = replace_once(text, r'function importFromSheet\(\)\s*\{.*?\n\}', replacement, 'sheet import', re.S)
    # Keep the reviewed capability and existing stable key when the email matches.
    original = """    rows.push({id:uid(),name:name,
      email:(col.email>=0?(f[col.email]||''):''),
      title:title,
      role:(rc?roleFromText(rc):roleFromTitle(title))});"""
    updated = """    var email=col.email>=0?(f[col.email]||''):'';
    var existing=DATA.find(function(r){return email && String(r.email||'').toLowerCase()===email.toLowerCase();});
    rows.push({id:existing?existing.id:uid(),name:name,email:email,title:title,
      role:(rc?roleFromText(rc):(existing?existing.role:''))});"""
    if text.count(original) != 1:
        raise ValueError('roster parser changed; review source before patching')
    text = text.replace(original, updated)
    text = text.replace('return {id:uid(),name:r.name,email:r.email,title:r.title,role:r.role};',
                        'return {id:r.id||uid(),name:r.name,email:r.email,title:r.title,role:r.role};')
    text = text.replace('一鍵帶入最新資料', '開啟名單匯入')
    text = re.sub(r'/\*[^*]*目前這份的共用.*?\*/',
                  '/* 幹部名單維持限制存取；只在已授權試算表複製或下載後預覽匯入。 */', text, flags=re.S)
    text = text.replace('從名單試算表帶入，再微調', '在已授權試算表複製資料，貼上後檢查預覽')
    start = "var roleNote=(IMPORT_META&&!IMPORT_META.hasRoleCol)?"
    pattern = re.escape(start) + r".*?:'';"
    note = "var roleNote=(IMPORT_META&&!IMPORT_META.hasRoleCol)?'未提供權限欄：既有人員保留原權限，新人預設無權限，職稱更新不會自動升權。':'';"
    text = replace_once(text, pattern, note, 'role import note')
    text = text.replace('（留空＝幹部；要停用某人填「無權限」）', '（未提供時保留既有權限；新人待授權；停用請填「無權限」）')
    return text


def patch_finance(text):
    text = replace_once(text, r'/\*\s*期初歷史收支.*?\*/',
                        '/* 正式收支明細只從已授權資料庫讀取；不在公開程式內預置。 */', 'ledger summary comment', re.S)
    text = replace_once(text, r'var SEED_LEDGER\s*=\s*\[.*?\n\];',
                        'var SEED_LEDGER=[]; // Historical entries remain only in the authorized database.', 'ledger seed', re.S)
    text = replace_once(text, r'\s*if\(!LEDGER\.length && !seeded && ITRCAuth\.can\(\'treasury\'\)\)\{.*?\}',
                        '', 'automatic ledger reseeding', re.S)
    text = re.sub(r'\s*// 雲端收支表空白時[^\n]*', '', text)
    return text


def patch_manual(text, club_only_bootstrap):
    text = re.sub(r'^- \*\*內建期初資料\*\*:.*$',
                  '- **收支資料來源**：正式帳務只從已授權資料庫讀取；空帳冊不會自動匯入歷史明細。', text, flags=re.M)
    text = replace_once(text, r'### 一鍵帶入最新資料\(從名單試算表\).*?(?=\n### |\n## )', """### 從受限制的名單試算表匯入

名單試算表保留限制存取。管理者在已授權的試算表複製資料後貼到工具，或下載 CSV 再選檔；按「開啟名單匯入」可開啟匯入區。工具先預覽姓名、Email、職稱與權限，確認後才取代名單。

- 欄位順序不限，依姓名／Email／職稱／權限標題辨識。
- 沒有權限欄時：依相同 Email 保留既有角色與 ID；新人預設無權限。修改職稱不會自動升權。
- 權限變更要由有管理權限的人明確檢查。換屆先封存舊名單，再確認目前人員與角色。
- 匯入仍會整份取代名單；先核對缺漏。這個操作不更動收支資料。
- 不必發布到網路，也不必開放持有連結者讀取。
""", 'manual private import instructions', re.S)
    text = text.replace('一鍵帶入最新資料', '預覽匯入名單').replace('一鍵帶入列', '名單匯入列')
    if club_only_bootstrap:
        text = re.sub(r'^另外還有一條\*\*救命索\*\*:.*$',
                      '另外保留**社團公開帳號**作為救援管理員，避免換屆後無人可維護名單。個人帳號的角色依內部權限名單決定；不在公開程式預置個人信箱。', text, flags=re.M)
    return text


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--club-only-bootstrap', action='store_true',
                        help='Keep the public club account as the only hardcoded rescue identity; verify personal advisor roles before deployment.')
    args = parser.parse_args()
    if args.output.exists():
        raise SystemExit('Output already exists; choose a new review directory.')
    roster_name = 'ITRC管理組-幹部與權限.html'
    finance_name = 'ITRC財務站.html'
    roster = patch_roster((args.source / roster_name).read_text())
    finance = patch_finance((args.source / finance_name).read_text())
    manual = patch_manual((args.source / '使用說明.html').read_text(), args.club_only_bootstrap)
    for name in ['index.html', 'itrc.js', 'itrc.css', 'itrc-auth.js']:
        if not (args.source / name).is_file():
            raise SystemExit(f'Missing existing site asset: {name}')
    shutil.copytree(args.source, args.output)
    (args.output / roster_name).write_text(roster)
    (args.output / finance_name).write_text(finance)
    (args.output / '使用說明.html').write_text(manual)
    if args.club_only_bootstrap:
        auth_path = args.output / 'itrc-auth.js'
        auth = auth_path.read_text()
        match = re.search(r'var SUPER_ADMINS\s*=\s*\[([^]]+)\];', auth)
        if not match:
            raise ValueError('Bootstrap declaration changed; review source before deploying output')
        identities = re.findall(r"['\"]([^'\"]+@[^'\"]+)['\"]", match.group(1))
        public_identity = 'zhongshantouyan@gmail.com'
        if public_identity not in identities:
            raise ValueError('Expected existing club rescue account is missing; do not deploy output')
        auth = auth.replace(match.group(0), f"var SUPER_ADMINS = ['{public_identity}'];")
        auth_path.write_text(auth)
        private_identities = set(identities) - {public_identity}
        for path in args.output.glob('*.html'):
            text = path.read_text()
            for identity in private_identities:
                text = text.replace(identity, '（請見內部權限名單）')
            # Previously fictional gmail.com addresses in the import tutorial should
            # use a reserved, non-deliverable example domain.
            if path.name == roster_name:
                counter = [0]
                def example_address(match):
                    if match.group(0) == public_identity: return match.group(0)
                    counter[0] += 1
                    return f'person{counter[0]}@example.invalid'
                text = re.sub(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}', example_address, text)
            path.write_text(text)
    manifest = {str(path.relative_to(args.output)): hashlib.sha256(path.read_bytes()).hexdigest()
                for path in sorted(args.output.rglob('*')) if path.is_file()}
    (args.output / 'hardening-manifest.json').write_text(json.dumps({
        'scope': 'static source only; no deployed permissions or database writes',
        'changes': ['remove roster seed', 'remove historical finance seed', 'disable automatic cloud reseeding',
                    'replace anonymous CSV import with authorized copy/file workflow',
                    'preserve existing person keys and roles when importing without explicit permissions'],
        'clubOnlyBootstrap': args.club_only_bootstrap,
        'remaining': ['RTDB authorization migration', 'verify retained personal advisor roles if bootstrap removed',
                      'deployment and signed-in workflow verification'],
        'sha256': manifest,
    }, ensure_ascii=False, indent=2))
    print(json.dumps({'output': str(args.output), 'files': len(manifest), 'deployed': False}, ensure_ascii=False))


if __name__ == '__main__':
    main()
