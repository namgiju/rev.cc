#!/usr/bin/env python3
"""Check a fresh JPA + existing Express schema without touching public tables."""
import subprocess
import time
import uuid

schema = 'garage_bootstrap_' + uuid.uuid4().hex[:10]
container = 'revcc-garage-bootstrap-' + uuid.uuid4().hex[:8]

def run(args, text=None, check=True):
    return subprocess.run(args, input=text, text=True, check=check, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

def sql(statement):
    return run(['docker','compose','exec','-T','postgres','psql','-U','revcc','-d','revcc','-v','ON_ERROR_STOP=1','-c',statement])

try:
    sql(f'CREATE SCHEMA {schema}')
    run(['docker','compose','run','--no-deps','-d','--name',container,
        '-e',f'SPRING_DATASOURCE_URL=jdbc:postgresql://postgres:5432/revcc?currentSchema={schema}','core'])
    for _ in range(40):
        health = run(['docker','exec',container,'curl','-fsS','http://localhost:8080/api/vehicles'],check=False)
        if health.returncode == 0:
            break
        time.sleep(1)
    else:
        raise AssertionError('Fresh Spring schema failed to start')
    code = """
import pg from 'pg';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new pg.Pool();
try {
 const migration=await readFile('./src/schema.sql','utf8');
 await db.query(migration);await db.query(migration);
 const user=(await db.query("INSERT INTO users(username,password) VALUES('bootstrap','test-only') RETURNING id")).rows[0];
 const image=(await db.query("INSERT INTO community_images(owner_id,mime,data) VALUES($1,'image/png',$2) RETURNING id",[user.id,Buffer.from('test')])).rows[0];
 const vehicle=(await db.query("INSERT INTO owner_vehicles(owner_id,model,year,image_id) VALUES($1,'Legacy model',2024,$2) RETURNING *",[user.id,image.id])).rows[0];
 assert.equal(vehicle.manufacturer,'');assert.equal(vehicle.transmission,'');assert.equal(vehicle.nickname,'');
 assert.ok(vehicle.created_at);assert.ok(vehicle.updated_at);
 await db.query("INSERT INTO vehicle_records(vehicle_id,kind,title,recorded_on) VALUES($1,'maintenance','test',CURRENT_DATE)",[vehicle.id]);
 await db.query('DELETE FROM users WHERE id=$1',[user.id]);
 assert.equal((await db.query('SELECT * FROM owner_vehicles')).rows.length,0);
 assert.equal((await db.query('SELECT * FROM vehicle_records')).rows.length,0);
 console.log('PASS: fresh Spring JPA schema, idempotent Express migration, legacy inserts, owner/photo/record foreign keys and cascade cleanup.');
} finally {await db.end();}
"""
    result=run(['docker','compose','exec','-T','-e',f'PGOPTIONS=-c search_path={schema}','board','node','--input-type=module'],code)
    print(result.stdout.strip())
finally:
    run(['docker','rm','-f',container],check=False)
    sql(f'DROP SCHEMA IF EXISTS {schema} CASCADE')
