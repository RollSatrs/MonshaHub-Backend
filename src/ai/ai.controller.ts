import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AiService } from './ai.service';
import { ChatAiDto } from './dto/chat-ai.dto';

@ApiTags('ai')
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('chat')
  async chat(@Body() dto: ChatAiDto) {
    const answer = await this.aiService.chat(dto.message);
    return { answer };
  }
}
