import fetch from 'node-fetch';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
if (!OPENROUTER_API_KEY) {
  throw new Error("OpenRouter API key is not set. Please set the OPENROUTER_API_KEY environment variable.");
}

export async function askGPT(messages: { role: string; content: string }[]): Promise<string> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini", // example model available on OpenRouter; you can list others via their API
      messages,
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  console.log("OpenRouter response:", JSON.stringify(data, null, 2));

  return data.choices?.[0]?.message?.content || "No response";
}

export default askGPT;