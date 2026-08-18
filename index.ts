import 'dotenv/config';
import { streamText } from 'ai';

async function main() {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error('Missing AI_GATEWAY_API_KEY. Put it in .env.local or your Vercel environment variables.');
  }

  const result = streamText({
    model: 'openai/gpt-5.4',
    prompt: 'Explain what the Software Passport Network does in three concise sentences.',
  });

  for await (const textPart of result.textStream) {
    process.stdout.write(textPart);
  }

  console.log('\n');
  console.log('Token usage:', await result.usage);
  console.log('Finish reason:', await result.finishReason);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
