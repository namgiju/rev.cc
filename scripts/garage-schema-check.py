#!/usr/bin/env python3
"""Check a fresh Flyway schema (core startup) + legacy Express inserts on a temporary PostgreSQL.

Never touches the shared/Neon DB or the compose stack: it builds core/board from the current
source and runs them on a throwaway Docker network with its own postgres/redis.
"""
import subprocess
import time
import uuid

suffix = uuid.uuid4().hex[:8]
network = 'revcc-garage-check-' + suffix
pg, redis, core = network + '-pg', network + '-redis', network + '-core'
schema = 'garage_bootstrap_' + uuid.uuid4().hex[:10]
core_image, board_image = 'revcc-core:garage-check', 'revcc-board:garage-check'

def run(args, text=None, check=True):
    return subprocess.run(args, input=text, text=True, check=check, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

def sql(statement, check=True):
    return run(['docker','exec',pg,'psql','-h','127.0.0.1','-U','revcc','-d','revcc','-v','ON_ERROR_STOP=1','-c',statement],check=check)

try:
    run(['docker','build','-q','-t',core_image,'./backend'])
    run(['docker','build','-q','-t',board_image,'./board-service'])
    run(['docker','network','create',network])
    run(['docker','run','-d','--name',pg,'--network',network,'-e','POSTGRES_USER=revcc','-e','POSTGRES_PASSWORD=revcc','-e','POSTGRES_DB=revcc','postgres:16'])
    run(['docker','run','-d','--name',redis,'--network',network,'redis:7-alpine'])
    for _ in range(60):  # TCP is only accepted after initdb finishes.
        if sql('SELECT 1',check=False).returncode == 0:
            break
        time.sleep(1)
    else:
        raise AssertionError('Temporary PostgreSQL failed to start')
    sql(f'CREATE SCHEMA {schema}')
    # core의 Flyway가 빈 스키마에 V1 → V2를 적용하고 Hibernate validate를 통과해야 기동된다.
    run(['docker','run','-d','--name',core,'--network',network,
        '-e',f'SPRING_DATASOURCE_URL=jdbc:postgresql://{pg}:5432/revcc?currentSchema={schema}',
        '-e','POSTGRES_USER=revcc','-e','POSTGRES_PASSWORD=revcc','-e',f'REDIS_HOST={redis}',core_image])
    for _ in range(60):
        health = run(['docker','exec',core,'curl','-fsS','http://localhost:8080/api/vehicles'],check=False)
        if health.returncode == 0:
            break
        time.sleep(1)
    else:
        raise AssertionError('Fresh Flyway schema failed to start core:\n' + run(['docker','logs',core],check=False).stderr[-3000:])
    code = """
import pg from 'pg';
import assert from 'node:assert/strict';
const db=new pg.Pool();
try {
 const history=(await db.query('SELECT version,success FROM flyway_schema_history ORDER BY installed_rank')).rows;
 assert.deepEqual(history.map(r=>r.version),['1','2']);assert.ok(history.every(r=>r.success));
 const user=(await db.query("INSERT INTO users(username,password) VALUES('bootstrap','test-only') RETURNING id")).rows[0];
 const image=(await db.query("INSERT INTO community_images(owner_id,mime,data) VALUES($1,'image/png',$2) RETURNING id",[user.id,Buffer.from('test')])).rows[0];
 const vehicle=(await db.query("INSERT INTO owner_vehicles(owner_id,model,year,image_id) VALUES($1,'Legacy model',2024,$2) RETURNING *",[user.id,image.id])).rows[0];
 assert.equal(vehicle.manufacturer,'');assert.equal(vehicle.transmission,'');assert.equal(vehicle.nickname,'');
 assert.ok(vehicle.created_at);assert.ok(vehicle.updated_at);
 await db.query("INSERT INTO vehicle_records(vehicle_id,kind,title,recorded_on) VALUES($1,'maintenance','test',CURRENT_DATE)",[vehicle.id]);
 await db.query('DELETE FROM users WHERE id=$1',[user.id]);
 assert.equal((await db.query('SELECT * FROM owner_vehicles')).rows.length,0);
 assert.equal((await db.query('SELECT * FROM vehicle_records')).rows.length,0);
 console.log('PASS: fresh Flyway schema (V1 -> V2) with core startup/validate, legacy inserts, owner/photo/record foreign keys and cascade cleanup.');
} finally {await db.end();}
"""
    result = run(['docker','run','--rm','-i','--network',network,
        '-e',f'PGHOST={pg}','-e','PGUSER=revcc','-e','PGPASSWORD=revcc','-e','PGDATABASE=revcc',
        '-e',f'PGOPTIONS=-c search_path={schema}',board_image,'node','--input-type=module'],code)
    print(result.stdout.strip())
finally:
    run(['docker','rm','-f',core,redis,pg],check=False)
    run(['docker','network','rm',network],check=False)
