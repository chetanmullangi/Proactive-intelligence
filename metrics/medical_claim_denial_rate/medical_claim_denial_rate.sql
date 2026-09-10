SELECT
  bucket                                   AS metric_timestamp,
  'main.medical_claim_header.avg_is_denied' AS metric_name,
  value                                    AS metric_value
FROM (
  WITH bounds AS (SELECT DATEADD(day,-90, MAX(SERVICE_START_DATE)) AS start_dt FROM HEALTH_CARE.MAIN.MEDICAL_CLAIM_HEADER)
  SELECT DATE_TRUNC('week', SERVICE_START_DATE) AS bucket, AVG(IFF(CLAIM_STATUS='DENIED',1,0)) AS value
  FROM HEALTH_CARE.MAIN.MEDICAL_CLAIM_HEADER, bounds
  WHERE SERVICE_START_DATE >= bounds.start_dt
  GROUP BY 1 ORDER BY 1
)
