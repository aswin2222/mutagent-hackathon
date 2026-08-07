import fs from "fs";
import path from "path";

interface TestCase {
  id: string;
  category: string;
  description: string;
  input: string;
  speaker?: string;
  expected_cleaned?: string;
  check_filler_removed?: boolean;
  check_terms_preserved?: string[];
  expected_answer_contains?: string;
  expected_source?: string;
  expected_confidence?: string;
  expected_action_item?: boolean;
}

interface EvalReport {
  timestamp: string;
  total_cases: number;
  passed_cases: number;
  failed_cases: number;
  overall_score: string;
  latency_avg_ms: number;
  results: any[];
}

const SERVER_URL = "http://localhost:3000";

async function runEvaluation() {
  console.log("=================================================");
  console.log("   MUTAGENT EVALUATION SUITE — MEETING SHADOW AGENT");
  console.log("=================================================\n");

  const baseDir = path.resolve(process.cwd(), "submissions/meeting-shadow-agent");
  const evalSuitePath = path.join(baseDir, "eval/eval_suite.json");
  const evalSuiteData = JSON.parse(fs.readFileSync(evalSuitePath, "utf-8"));
  const testCases: TestCase[] = evalSuiteData.test_cases;

  let passed = 0;
  let failed = 0;
  let totalLatencyMs = 0;
  const results: any[] = [];

  for (const tc of testCases) {
    console.log(`[TEST ${tc.id}] ${tc.description}`);
    const start = Date.now();

    try {
      let isSuccess = false;
      let actualOutput: any = null;

      if (tc.category === "live_enhancement" || tc.category === "speaker_diarization") {
        const res = await fetch(`${SERVER_URL}/api/clarity/enhance`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rawChunk: tc.input, speaker: tc.speaker || "Speaker 1" }),
        });
        const data: any = await res.json();
        actualOutput = data;

        if (data.success && data.enhancedLine) {
          const enhanced = data.enhancedLine.enhancedText;
          let fillerPassed = true;
          if (tc.check_filler_removed) {
            fillerPassed = !/\b(um+|uh+|like|you know)\b/i.test(enhanced);
          }

          let termsPassed = true;
          if (tc.check_terms_preserved) {
            termsPassed = tc.check_terms_preserved.every((term) =>
              enhanced.toLowerCase().includes(term.toLowerCase())
            );
          }

          isSuccess = fillerPassed && termsPassed;
        }
      } else if (tc.category === "qna_retrieval" || tc.category === "zero_hallucination") {
        const res = await fetch(`${SERVER_URL}/api/clarity/ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: tc.input, speaker: tc.speaker || "Speaker 1" }),
        });
        const data: any = await res.json();
        actualOutput = data;

        if (data.success && data.question) {
          const q = data.question;
          let answerMatch = true;
          if (tc.expected_answer_contains) {
            answerMatch =
              q.answer &&
              q.answer.toLowerCase().includes(tc.expected_answer_contains.toLowerCase());
          }

          let confMatch = true;
          if (tc.expected_confidence) {
            confMatch = q.confidence === tc.expected_confidence;
          }

          let actionMatch = true;
          if (tc.expected_action_item) {
            actionMatch = q.confidence === "unresolved";
          }

          isSuccess = Boolean(answerMatch && confMatch && actionMatch);
        }
      }

      const durationMs = Date.now() - start;
      totalLatencyMs += durationMs;

      if (isSuccess) {
        passed++;
        console.log(`   └─ ✅ PASS (${durationMs}ms)`);
      } else {
        failed++;
        console.log(`   └─ ❌ FAIL (${durationMs}ms)`);
      }

      results.push({
        test_id: tc.id,
        category: tc.category,
        passed: isSuccess,
        latency_ms: durationMs,
        output: actualOutput,
      });
    } catch (err: any) {
      failed++;
      console.log(`   └─ ❌ ERROR: ${err.message}`);
      results.push({
        test_id: tc.id,
        category: tc.category,
        passed: false,
        error: err.message,
      });
    }
  }

  const avgLatency = Math.round(totalLatencyMs / testCases.length);
  const scorePercent = ((passed / testCases.length) * 100).toFixed(1);

  console.log("\n-------------------------------------------------");
  console.log(`SUMMARY: ${passed}/${testCases.length} Passed (${scorePercent}%)`);
  console.log(`Average Latency: ${avgLatency}ms`);
  console.log("-------------------------------------------------\n");

  const report: EvalReport = {
    timestamp: new Date().toISOString(),
    total_cases: testCases.length,
    passed_cases: passed,
    failed_cases: failed,
    overall_score: `${scorePercent}%`,
    latency_avg_ms: avgLatency,
    results,
  };

  const tracesDir = path.join(baseDir, "traces");
  if (!fs.existsSync(tracesDir)) {
    fs.mkdirSync(tracesDir, { recursive: true });
  }

  const tracePath = path.join(tracesDir, "eval_execution_trace.json");
  fs.writeFileSync(tracePath, JSON.stringify(report, null, 2));
  console.log(`Wrote evaluation trace to ${tracePath}`);
}

runEvaluation();
