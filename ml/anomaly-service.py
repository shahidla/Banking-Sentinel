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

    # Training — portfolio-wide (mirrors PAL: train on BANKINGSENTINEL_DFKKOP/DFKKOPK TOP 500)
    # 2D feature vector: [payment_delay_days (AUGDT/BUDAT - FAEDN), dunning_level (MAHNS, 0-3)].
    # Captures JOINT escalation across two differently-typed dimensions — IF can flag a
    # customer whose delay AND dunning level are both drifting even when neither alone
    # crosses a fixed threshold a single-field WHERE clause could replicate.
    X_train = np.array([
        [float(r.get('payment_delay_days', 0)), float(r.get('dunning_level', 0))]
        for r in portfolio
    ])

    clf = IsolationForest(
        n_estimators=100,       # PAL NUM_TREES=100
        contamination='auto',   # threshold derived from the data distribution
        random_state=42         # PAL SEED=42
    )
    clf.fit(X_train)

    # Portfolio stats for reason codes (mirrors PAL EXPLAIN_SCOPE=1)
    mean_delay   = float(np.mean(X_train[:, 0]))
    std_delay    = float(np.std(X_train[:, 0])) or 1.0
    mean_dunning = float(np.mean(X_train[:, 1]))
    std_dunning  = float(np.std(X_train[:, 1])) or 1.0

    # Scoring — this customer's rows
    X_score = np.array([
        [float(r.get('payment_delay_days', 0)), float(r.get('dunning_level', 0))]
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
            z_delay   = abs(float(row.get('payment_delay_days', 0)) - mean_delay)   / std_delay
            z_dunning = abs(float(row.get('dunning_level', 0))      - mean_dunning) / std_dunning
            if z_delay >= z_dunning:
                reason = f"PAYMENT_DELAY_DAYS {row.get('payment_delay_days', 0)} (z={z_delay:.2f}, portfolio mean={mean_delay:.1f})"
            else:
                reason = f"DUNNING_LEVEL {row.get('dunning_level', 0)} (z={z_dunning:.2f}, portfolio mean={mean_dunning:.1f})"

        results.append({
            'id':          row.get('id', f'P{i + 1}'),
            'score':       round(score, 6),
            'label':       int(label),
            'reason_code': reason
        })

    return jsonify({'results': results, 'engine': 'scikit', 'trained_on': len(portfolio), 'scored': len(payments)})


if __name__ == '__main__':
    import os
    # CF sets PORT and routes to whatever the app binds to; SCIKIT_PORT is the local-dev override
    port = int(os.environ.get('PORT', os.environ.get('SCIKIT_PORT', 5001)))
    print(f'Banking Sentinel anomaly service starting on port {port}')
    app.run(host='0.0.0.0', port=port, debug=False)
