"""Results schema (HEALTH_CARE.ANALYTICS). JSON payloads are stored as VARCHAR (PARSE_JSON them in SQL when needed)."""
from __future__ import annotations

from .config import RS
from .db import execute

DDL = f"""
create schema if not exists {RS} comment = 'Proactive Intelligence engine results (the engine writes only here)';

create table if not exists {RS}.PI_RUN_LOG (
  RUN_ID varchar, AS_OF date, STEP varchar, STATUS varchar, STARTED_TS timestamp_ntz, FINISHED_TS timestamp_ntz,
  SECONDS number(10,1), DETAIL varchar);

create table if not exists {RS}.PI_TABLE (
  TABLE_FQN varchar, SCHEMA_NAME varchar, TABLE_NAME varchar, ROW_COUNT number, BYTES number, LAST_ALTERED timestamp_ntz,
  FINGERPRINT varchar, TABLE_ROLE varchar, GRAIN varchar, PRIMARY_KEY varchar, BUSINESS_NAME varchar, DESCRIPTION varchar,
  DEPARTMENT varchar, DEPARTMENT_SCORES varchar, EVENT_DATE varchar, ARRIVAL_DATE varchar, DATE_ROLES varchar,
  SUPERSEDED_BY varchar, IS_KPI_SOURCE boolean, MIN_EVENT_DATE date, MAX_EVENT_DATE date, NOTES varchar,
  PROFILED_TS timestamp_ntz);

create table if not exists {RS}.PI_COLUMN (
  TABLE_FQN varchar, COLUMN_NAME varchar, ORDINAL number, DATA_TYPE varchar, ROLE varchar, DATE_ROLE varchar,
  NON_NULL number, DISTINCT_APPROX number, MIN_VALUE varchar, MAX_VALUE varchar, FUTURE_SHARE float,
  TOP_VALUES varchar, PROFILED_TS timestamp_ntz);

create table if not exists {RS}.PI_EDGE (
  EDGE_ID varchar, KIND varchar, FROM_NODE varchar, TO_NODE varchar, FROM_COLUMN varchar, TO_COLUMN varchar,
  SOURCE varchar, CONFIDENCE varchar, STRENGTH float, LAG_DAYS float, EVIDENCE varchar, UPDATED_TS timestamp_ntz);

create table if not exists {RS}.PI_KPI (
  KPI_ID varchar, TABLE_FQN varchar, KIND varchar, BUSINESS_NAME varchar, DESCRIPTION varchar, UNIT varchar,
  DATE_EXPR varchar, NUM_EXPR varchar, DEN_EXPR varchar, ROW_FILTER varchar, FROM_SQL varchar, ADDITIVE boolean,
  NATIVE_GRAIN varchar, DIRECTION_GOOD varchar, DEPARTMENT varchar, TAGS varchar, DIMENSIONS varchar,
  DEFINITION_HASH varchar, UPDATED_TS timestamp_ntz);

create table if not exists {RS}.PI_KPI_DAILY (KPI_ID varchar, D date, NUM float, DEN float, N_ROWS number);
create table if not exists {RS}.PI_KPI_DAILY_DIM (KPI_ID varchar, D date, DIM varchar, VAL varchar, NUM float, DEN float);

create table if not exists {RS}.PI_KPI_BUILD (
  TABLE_FQN varchar, DEFINITION_HASH varchar, FINGERPRINT varchar, MODE varchar, RESTATE_FROM date,
  BUILT_TS timestamp_ntz, ROWS_WRITTEN number, RECONCILED_TS timestamp_ntz, RECONCILE_OK boolean, RECONCILE_DETAIL varchar);

create table if not exists {RS}.PI_COMPLETENESS (
  TABLE_FQN varchar, EVENT_DATE varchar, ARRIVAL_DATE varchar, LAG_DAYS number, CUM_SHARE float, UPDATED_TS timestamp_ntz);
alter table {RS}.PI_COMPLETENESS add column if not exists CURVE_KIND varchar;     -- arrival | decision
alter table {RS}.PI_COMPLETENESS add column if not exists CURVE_SOURCE varchar;   -- measured | inherited:<table>

create table if not exists {RS}.PI_PROCESS_CHAIN (
  CHAIN_ID varchar, PARENT_TABLE varchar, PARENT_DATE varchar, CHILD_TABLE varchar, CHILD_DATE varchar, JOIN_KEY varchar,
  PARENT_SEGMENT varchar, N_PARENT number, CONVERSION float, LAG_P10 float, LAG_P50 float, LAG_P90 float,
  LAG_CDF varchar, CHILD_AMOUNT_COLUMN varchar, CHILD_AMOUNT_PER_PARENT float, BUSINESS_TEXT varchar, UPDATED_TS timestamp_ntz);

create table if not exists {RS}.PI_KPI_STATE (
  RUN_ID varchar, AS_OF date, KPI_ID varchar, STATE varchar, DIRECTION varchar, SEVERITY float, Z float,
  PERIOD_LABEL varchar, ACTUAL float, EXPECTED float, LOWER float, UPPER float, COMPLETENESS float,
  COMPARISONS varchar, TREND varchar, FRESHNESS_DAYS number, IS_STALE boolean, USD_AT_STAKE float,
  WHY_TECHNICAL varchar, EVIDENCE varchar);

create table if not exists {RS}.PI_DQ_RESULT (
  RUN_ID varchar, AS_OF date, CHECK_ID varchar, TABLE_FQN varchar, CHECK_TYPE varchar, FAILED number, CHECKED number,
  SHARE float, SEVERITY varchar, DETAIL varchar);

create table if not exists {RS}.PI_PROJECTION (
  RUN_ID varchar, AS_OF date, SUBJECT_ID varchar, SUBJECT_KIND varchar, PERIOD_START date, GRAIN varchar,
  POINT float, LOWER float, UPPER float, METHOD varchar, SKILL_VS_NAIVE float, DETAIL varchar);

create table if not exists {RS}.PI_OUTLOOK (
  RUN_ID varchar, AS_OF date, METRIC varchar, BUSINESS_NAME varchar, PERIOD varchar, POINT float, LOWER float,
  UPPER float, SAME_PERIOD_LAST_YEAR float, LAST_PERIOD float, UNIT varchar, BASIS varchar, DRIVERS varchar);

create table if not exists {RS}.PI_FINDING (
  RUN_ID varchar, AS_OF date, FINDING_ID varchar, KIND varchar, SUBJECT_ID varchar, RANK number, SCORE float,
  USD_AT_STAKE float, MEMBERS_AFFECTED number, TIMING varchar, DEPARTMENTS varchar, DOWNSTREAM varchar,
  EVIDENCE varchar, CANDIDATE_CAUSES varchar, TECHNICAL_SUMMARY varchar);

create table if not exists {RS}.PI_WARNING (
  RUN_ID varchar, AS_OF date, WARNING_ID varchar, FINDING_ID varchar, DEDUP_KEY varchar, STATUS varchar,
  FIRST_SEEN date, SEVERITY varchar, KIND varchar, TITLE varchar, BUSINESS_REASON varchar, IMPACT_TEXT varchar,
  WHAT_TO_DO varchar, EXTERNAL_SIGNAL varchar, REASON_CONFIDENCE varchar, DEPARTMENTS varchar, DOWNSTREAM varchar,
  USD_AT_STAKE float, TIMING varchar, EVIDENCE varchar);
"""


def setup(conn):
    for stmt in [s.strip() for s in DDL.split(";") if s.strip()]:
        execute(conn, stmt)
