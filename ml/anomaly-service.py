# Banking Sentinel — Scikit-learn Isolation Forest Anomaly Service
# AI: Open-source equivalent of HANA PAL Isolation Forest (same Liu et al. 2008 algorithm)
# Banking: Train on portfolio payment history, score one customer's rows, return isolation scores
# SAP: Runs alongside CAP server. Switch back to PAL: set ANOMALY_ENGINE=pal in .env
#      PAL requires HANA Cloud 3 vCPU (ScriptServer). This service runs on any machine.

from flask import Flask, request, jsonify
from sklearn.ensemble import IsolationForest
import numpy as np

app = Flask(__name__)


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'ok', 'engine': 'scikit-learn IsolationForest'})


@app.route('/anomaly', methods=['POST'])
def anomaly():
    body = request.get_json(force=True)
    portfolio = body.get('portfolio', [])   # training rows — all customers (TOP 500 from DFKKOP)
    payments  = body.get('payments', [])    # scoring rows — this customer only

    if len(portfolio) < 5:
        return jsonify({'error': f'Not enough portfolio rows for training (got {len(portfolio)}, need >= 5)'}), 400
    if not payments:
        return jsonify({'error': 'No customer payment rows to score'}), 400

    # Training — portfolio-wide (mirrors PAL: train on BANKINGSENTINEL_DFKKOP TOP 500)
    X_train = np.array([
        [float(r.get('days_overdue', 0)), float(r.get('amount', 0))]
        for r in portfolio
    ])

    clf = IsolationForest(
        n_estimators=100,       # PAL NUM_TREES=100
        contamination=0.1,      # PAL CONTAMINATION=0.1
        random_state=42         # PAL SEED=42
    )
    clf.fit(X_train)

    # Portfolio stats for reason codes (mirrors PAL EXPLAIN_SCOPE=1)
    mean_days = float(np.mean(X_train[:, 0]))
    std_days  = float(np.std(X_train[:, 0])) or 1.0
    mean_amt  = float(np.mean(X_train[:, 1]))
    std_amt   = float(np.std(X_train[:, 1])) or 1.0

    # Scoring — this customer's rows
    X_score = np.array([
        [float(r.get('days_overdue', 0)), float(r.get('amount', 0))]
        for r in payments
    ])

    raw_scores = clf.score_samples(X_score)    # more negative = more anomalous
    labels     = clf.predict(X_score)          # -1 = outlier, 1 = inlier

    # Normalise to 0–1 where 1 = most anomalous (matches PAL SCORE output direction)
    s_min, s_max = raw_scores.min(), raw_scores.max()
    span = (s_max - s_min) or 1.0

    results = []
    for i, (row, raw, label) in enumerate(zip(payments, raw_scores, labels)):
        score = float((s_max - raw) / span)   # flip: high raw → low normalised → flip again

        reason = None
        if label == -1:
            z_days = abs(float(row.get('days_overdue', 0)) - mean_days) / std_days
            z_amt  = abs(float(row.get('amount', 0))       - mean_amt)  / std_amt
            if z_days >= z_amt:
                reason = f"DAYS_OVERDUE {row.get('days_overdue', 0)} (z={z_days:.2f}, portfolio mean={mean_days:.0f})"
            else:
                reason = f"AMOUNT {row.get('amount', 0):.0f} (z={z_amt:.2f}, portfolio mean={mean_amt:.0f})"

        results.append({
            'id':          row.get('id', f'P{i + 1}'),
            'score':       round(score, 6),
            'label':       int(label),
            'reason_code': reason
        })

    return jsonify({'results': results, 'engine': 'scikit', 'trained_on': len(portfolio), 'scored': len(payments)})


if __name__ == '__main__':
    import os
    port = int(os.environ.get('SCIKIT_PORT', 5001))
    print(f'Banking Sentinel anomaly service starting on port {port}')
    app.run(host='0.0.0.0', port=port, debug=False)
