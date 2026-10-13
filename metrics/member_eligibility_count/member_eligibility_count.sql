WITH src AS (
  SELECT (EFFECTIVE_DATE)::DATE AS d, x.*
  FROM HEALTH_CARE.MAIN.MEMBER_ELIGIBILITY x
  WHERE (EFFECTIVE_DATE) IS NOT NULL),
dd AS (SELECT DISTINCT d FROM src),
nat AS (
  SELECT CASE WHEN COUNT_IF(DAYOFYEAR(d) <> 1) = 0 AND COUNT(*) > 1 THEN 4
              WHEN COUNT_IF(DAY(d) <> 1) = 0 AND COUNT(*) > 1 THEN 3
              WHEN COUNT(DISTINCT DAYOFWEEKISO(d)) = 1 AND COUNT(*) > 1 THEN 2
              ELSE 1 END AS g,
         MIN(d) AS lo, MAX(d) AS hi
  FROM dd),
natg AS (
  SELECT g, DECODE(g, 1, 'day', 2, 'week', 3, 'month', 4, 'year') AS native_grain, lo,
         CASE g WHEN 1 THEN hi
                WHEN 2 THEN DATEADD(day, 6, hi)
                WHEN 3 THEN IFF(hi >= DATE_TRUNC('month', CURRENT_DATE()), LAST_DAY(DATEADD(month, -1, hi)), LAST_DAY(hi))
                ELSE IFF(YEAR(hi) >= YEAR(CURRENT_DATE()), DATE_FROM_PARTS(YEAR(hi) - 1, 12, 31), DATE_FROM_PARTS(YEAR(hi), 12, 31))
         END AS eff_hi,
         (g = 3 AND hi >= DATE_TRUNC('month', CURRENT_DATE())) OR (g = 4 AND YEAR(hi) >= YEAR(CURRENT_DATE())) AS latest_period_excluded
  FROM nat),
g0 AS (
  SELECT GROUPING_ID(d, DATE_TRUNC('week', d), DATE_TRUNC('month', d), DATE_TRUNC('year', d)) AS gid,
         COALESCE(d, DATE_TRUNC('week', d), DATE_TRUNC('month', d), DATE_TRUNC('year', d)) AS bucket,
         COUNT(*) AS value, COUNT(*) AS n
  FROM src
  GROUP BY GROUPING SETS ((d), (DATE_TRUNC('week', d)), (DATE_TRUNC('month', d)), (DATE_TRUNC('year', d)))),
b AS (
  SELECT DECODE(gid, 7, 'day', 11, 'week', 13, 'month', 14, 'year') AS grain,
         DECODE(gid, 7, 1, 11, 2, 13, 3, 14, 4) AS grank, bucket, value, n
  FROM g0, natg
  WHERE DECODE(gid, 7, 1, 11, 2, 13, 3, 14, 4) >= natg.g
    AND (bucket >= natg.lo OR DECODE(gid, 7, 1, 11, 2, 13, 3, 14, 4) = natg.g)
    AND DECODE(gid, 7, bucket, 11, DATEADD(day, 6, bucket), 13, LAST_DAY(bucket),
               14, DATEADD(day, -1, DATEADD(year, 1, bucket))) <= natg.eff_hi)
SELECT b.bucket AS metric_timestamp, 'main.member_eligibility.count_star' AS metric_name, b.value AS metric_value
FROM b, natg
WHERE b.grank = GREATEST(3, natg.g)
ORDER BY b.bucket
