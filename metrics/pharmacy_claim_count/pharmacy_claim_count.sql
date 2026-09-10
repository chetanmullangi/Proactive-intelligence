SELECT
  bucket                             AS metric_timestamp,
  'main.pharmacy_claim.count_star'   AS metric_name,
  value                              AS metric_value
FROM (
  WITH bounds AS (SELECT DATEADD(day,-90, MAX(FILL_DATE)) AS start_dt FROM HEALTH_CARE.MAIN.PHARMACY_CLAIM)
  SELECT DATE_TRUNC('week', FILL_DATE) AS bucket, COUNT(*) AS value
  FROM HEALTH_CARE.MAIN.PHARMACY_CLAIM, bounds
  WHERE FILL_DATE >= bounds.start_dt
  GROUP BY 1 ORDER BY 1
)
