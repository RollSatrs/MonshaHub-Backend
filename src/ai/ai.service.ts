import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';

@Injectable()
export class AiService {
  private openai: OpenAI;
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API,
    });
  }
  async chat(message: string): Promise<string> {
    try {
      const response = await this.openai.chat.completions.create({
        model: 'chatgpt-4o-latest',
        messages: [{ role: 'user', content: message }],
      });
      return response.choices[0].message.content!;
    } catch (err) {
      console.log(err);
      return 'error';
    }
  }
}
