#!/bin/bash
# Usage: rundb.sh <label>: make fresh rd_<label> and cp_<label> from the read-only templates reader_p and controlplane_p.
set -eu
L=$1; P="psql -h 127.0.0.1 -p 54329 -U postgres -q"
$P -c "drop database if exists rd_$L with (force)" -c "drop database if exists cp_$L with (force)"
$P -c "create database rd_$L template reader_p strategy file_copy"
$P -c "create database cp_$L template controlplane_p strategy file_copy"
