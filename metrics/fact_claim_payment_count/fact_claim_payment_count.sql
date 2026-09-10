SELECT
  bucket                                AS metric_timestamp,
  'main.fact_claim_payment.count_star'  AS metric_name,
  value                                 AS metric_value
FROM (
  WITH bounds AS (SELECT DATEADD(day,-90, MAX(PAYMENT_DATE)) AS start_dt FROM HEALTH_CARE.MAIN.FACT_CLAIM_PAYMENT)
  SELECT DATE_TRUNC('week', PAYMENT_DATE) AS bucket, COUNT(*) AS value
  FROM HEALTH_CARE.MAIN.FACT_CLAIM_PAYMENT, bounds
  WHERE PAYMENT_DATE >= bounds.start_dt
  GROUP BY 1 ORDER BY 1
)
