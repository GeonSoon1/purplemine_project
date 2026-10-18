import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  CreateQuoteDto,
  CreateQuoteItemDto,
  ListQuotesQueryDto,
  SaveQuoteDto,
  UpdateQuoteDto,
  UpdateQuoteItemDto,
} from './dto';
import { QuotesService } from './quotes.service';

@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Post()
  create(@Body() dto: CreateQuoteDto) {
    return this.quotes.create(dto);
  }

  @Get()
  list(@Query() q: ListQuotesQueryDto) {
    return this.quotes.list(q);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.get(id);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateQuoteDto) {
    return this.quotes.update(id, dto);
  }

  @Post(':id/save')
  @HttpCode(200)
  save(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveQuoteDto) {
    return this.quotes.save(id, dto);
  }

  @Post(':id/items')
  addItem(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateQuoteItemDto) {
    return this.quotes.addItem(id, dto);
  }

  @Patch(':id/items/:itemId')
  updateItem(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateQuoteItemDto,
  ) {
    return this.quotes.updateItem(id, itemId, dto);
  }

  @Delete(':id/items/:itemId')
  @HttpCode(200)
  removeItem(@Param('id', ParseUUIDPipe) id: string, @Param('itemId', ParseUUIDPipe) itemId: string) {
    return this.quotes.removeItem(id, itemId);
  }

  @Post(':id/revisions')
  revise(@Param('id', ParseUUIDPipe) id: string) {
    return this.quotes.revise(id);
  }
}
