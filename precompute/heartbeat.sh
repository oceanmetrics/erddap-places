#!/usr/bin/env bash
# every HEARTBEAT_MIN (5) minutes, append a status block to the precompute's progress log: how long it
# has run, how long its output has been quiet, its counts so far, and whether each ERDDAP server it is
# working on answers. Started in the background by .github/workflows/stats.yml, which tees the
# precompute's output into the same file and removes it when the job ends. On the runner host:
#   tail -f ~/actions-runner/erddap-places/_work/erddap-places/stats-progress.log
#   grep '^@@' ~/actions-runner/erddap-places/_work/erddap-places/stats-progress.log | tail -20
#
# Usage: precompute/heartbeat.sh <progress log>

log=$1
every=${HEARTBEAT_MIN:-5}
t0=$(date +%s)
last_n=0
quiet=0

hm() { printf '%dh%02d' $(($1 / 3600)) $(($1 % 3600 / 60)); }

while sleep $((every * 60)); do
  [ -f "$log" ] || continue
  # the precompute's own lines (each stamped HH:MM:SSZ by the workflow), not these
  n=$(grep -vc '^@@' "$log")
  if [ "$n" -eq "$last_n" ]; then quiet=$((quiet + every)); else quiet=0; fi
  last_n=$n
  {
    echo "@@ $(date -u +%H:%MZ)  running $(hm $(($(date +%s) - t0)))  output quiet ${quiet} min  places started $(grep -c ' -- ' "$log")  failures $(grep -c '!! ' "$log")"
    rest=$(grep -E '^[^ ]+ \.\. .* rests ' "$log" | tail -1)
    [ -z "$rest" ] || echo "@@   last rest: $rest"
    # the hosts from the precompute's "N unit(s) on M server(s): host n, host n" line
    for h in $(grep -m1 -oE 'server\(s\): .*' "$log" | sed 's/^server(s): //' | tr ',' '\n' | awk '{print $1}'); do
      echo "@@   $h  $(curl -sS -o /dev/null -m 20 -w 'HTTP %{http_code} in %{time_total} s' "https://$h/erddap/version" 2>&1 | tail -1)"
    done
  } >> "$log"
done
