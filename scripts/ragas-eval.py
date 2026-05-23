#!/usr/bin/env python3
"""
Banking Sentinel — Phase 2: Faithfulness Evaluation
AI Pattern: RAG Evaluation (LLMOps quality measurement)
Banking: Measures whether retrieved APRA regulatory context actually supports the generated answers
SAP: Scores feed into Langfuse observability dashboard as quality metrics

What this does:
  For each of the 9 regulatory RAGAS questions, we measure:
  - Faithfulness: Are all claims in the answer supported by the retrieved context?
  - Answer Relevancy: Does the answer address the question?
  We use GPT-4o-mini as the evaluator judge (the RAGAS approach under the hood)

Note on RAGAS library:
  The RAGAS library (0.3.x and 0.4.x) currently has a broken import:
  langchain_community.chat_models.vertexai was moved to langchain-google-vertexai
  and is missing from the current langchain-community package. This script
  implements the same faithfulness metric directly using the OpenAI API.

Run: python scripts/ragas-eval.py
"""

import json
import os
import sys
from pathlib import Path

def load_env():
    env_path = Path(__file__).parent.parent / '.env'
    if env_path.exists():
        for line in env_path.read_text(encoding='utf-8').splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, _, value = line.partition('=')
                value = value.strip().strip('"').strip("'")
                if key not in os.environ:
                    os.environ[key.strip()] = value

def call_openai(messages, model='gpt-4o-mini', temperature=0):
    import urllib.request
    import urllib.error
    payload = json.dumps({
        'model': model,
        'messages': messages,
        'temperature': temperature,
        'max_tokens': 600
    }).encode('utf-8')
    req = urllib.request.Request(
        'https://api.openai.com/v1/chat/completions',
        data=payload,
        headers={
            'Authorization': f'Bearer {os.environ["OPENAI_API_KEY"]}',
            'Content-Type': 'application/json'
        },
        method='POST'
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode())
    return data['choices'][0]['message']['content'].strip()

def evaluate_faithfulness(question, answer, contexts):
    """
    AI:      NLI-based faithfulness — every claim in the answer must be
             supported by the retrieved context (not general knowledge)
    Banking: Did the AI's risk recommendation actually come from APRA documents
             or was it hallucinated? Hallucinated regulatory facts = compliance risk
    SAP:     This score feeds into CPS 230 AI audit trail requirements
    """
    context_text = '\n\n---\n\n'.join(contexts[:5])  # top 5 chunks
    prompt = f"""You are evaluating whether an AI-generated answer is faithful to regulatory source documents.

REGULATORY SOURCE DOCUMENTS:
{context_text}

AI GENERATED ANSWER:
{answer}

QUESTION ASKED:
{question}

Task: Score the FAITHFULNESS of the answer on a scale from 0.0 to 1.0.

Faithfulness means: every factual claim in the answer must be directly supported by the source documents above.
- 1.0 = every claim is explicitly supported by the sources
- 0.85+ = nearly all claims are supported, minor elaborations acceptable
- 0.70 = most claims supported, some unsourced statements
- Below 0.70 = significant claims not grounded in sources

Return ONLY a decimal number between 0.0 and 1.0. No explanation."""

    response = call_openai([{'role': 'user', 'content': prompt}])
    try:
        # Extract the first number from the response
        import re
        match = re.search(r'\d+\.?\d*', response)
        score = float(match.group()) if match else 0.5
        return min(1.0, max(0.0, score))
    except (ValueError, AttributeError):
        return 0.5

def evaluate_answer_relevancy(question, answer):
    """
    AI:      Does the answer address what was asked? Penalises evasive or
             off-topic answers
    Banking: A regulatory compliance answer that avoids the specific threshold
             asked is not useful to the risk officer
    SAP:     Complements faithfulness in the observability dashboard
    """
    prompt = f"""Score how well the following answer addresses the question asked.

QUESTION: {question}
ANSWER: {answer}

Score from 0.0 (completely irrelevant) to 1.0 (directly and completely answers the question).
Return ONLY a decimal number between 0.0 and 1.0. No explanation."""

    response = call_openai([{'role': 'user', 'content': prompt}])
    try:
        import re
        match = re.search(r'\d+\.?\d*', response)
        score = float(match.group()) if match else 0.5
        return min(1.0, max(0.0, score))
    except (ValueError, AttributeError):
        return 0.5

def main():
    print('\n Banking Sentinel — Phase 2: Faithfulness Evaluation')
    print('=' * 52)
    print()

    load_env()

    if not os.environ.get('OPENAI_API_KEY'):
        print('ERROR: OPENAI_API_KEY not found')
        sys.exit(1)

    # Load RAGAS dataset generated by test-rag.js
    dataset_path = Path(__file__).parent.parent / 'Data' / 'ragas-dataset.json'
    if not dataset_path.exists():
        print(f'ERROR: {dataset_path} not found')
        print('Run first: cds bind --exec node scripts/test-rag.js')
        sys.exit(1)

    with open(dataset_path, 'r', encoding='utf-8') as f:
        dataset = json.load(f)

    valid = [d for d in dataset if not d['answer'].startswith('ERROR:')]
    print(f'  Evaluating {len(valid)} questions...')
    print(f'  Method: OpenAI GPT-4o-mini as judge (equivalent to RAGAS faithfulness metric)\n')

    results = []

    for i, record in enumerate(valid):
        q_id = record.get('question_id', f'Q{i+1}')
        question = record['question']
        answer = record['answer']
        contexts = record.get('contexts', [])

        print(f'  [{i+1}/{len(valid)}] {q_id}', end=' ', flush=True)

        f_score = evaluate_faithfulness(question, answer, contexts)
        r_score = evaluate_answer_relevancy(question, answer)

        status = 'PASS' if f_score >= 0.85 else 'FAIL'
        print(f'  faithfulness={f_score:.3f} [{status}]  relevancy={r_score:.3f}')

        results.append({
            'question_id': q_id,
            'question': question,
            'faithfulness': f_score,
            'answer_relevancy': r_score,
            'contexts_retrieved': len(contexts),
            'top_context_title': record.get('context_titles', [''])[0]
        })

    # Aggregate scores
    avg_faithfulness = sum(r['faithfulness'] for r in results) / len(results)
    avg_relevancy = sum(r['answer_relevancy'] for r in results) / len(results)
    milestone_achieved = avg_faithfulness >= 0.85

    print()
    print('=' * 52)
    print('  RESULTS')
    print('=' * 52)
    print(f'  faithfulness (avg):    {avg_faithfulness:.4f}  [{"PASS" if avg_faithfulness >= 0.85 else "FAIL"} — target 0.85]')
    print(f'  answer_relevancy (avg): {avg_relevancy:.4f}')
    print(f'  questions evaluated:    {len(results)}')
    print()

    if milestone_achieved:
        print('  *** PHASE 2 MILESTONE ACHIEVED ***')
        print(f'    faithfulness = {avg_faithfulness:.4f} >= 0.85')
        print('    APRA regulatory knowledge base is grounded and retrievable.')
        print('    Hybrid RAG + HyDE pipeline ready for Phase 3 agents.')
    else:
        print(f'  ✗ Phase 2 milestone not yet met — faithfulness = {avg_faithfulness:.4f}')
        low = [r for r in results if r['faithfulness'] < 0.85]
        print(f'    {len(low)} questions below threshold:')
        for r in low:
            print(f'      {r["question_id"]}: {r["faithfulness"]:.3f}')

    # Save results
    output = {
        'overall': {
            'faithfulness': avg_faithfulness,
            'answer_relevancy': avg_relevancy,
            'milestone_achieved': milestone_achieved,
            'faithfulness_target': 0.85,
            'questions_evaluated': len(results)
        },
        'per_question': results
    }
    output_path = Path(__file__).parent.parent / 'Data' / 'ragas-results.json'
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2)

    print(f'\n  Results saved to: Data/ragas-results.json')
    print('=' * 52 + '\n')

    sys.exit(0 if milestone_achieved else 1)

if __name__ == '__main__':
    main()
