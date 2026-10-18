import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { AnalysisService } from './analysis.service';
import { CreateRequirementDto, SelectionDto, UpdateRequirementDto } from './dto';
import { RequirementsService } from './requirements.service';

@Controller()
export class AnalysisController {
  constructor(
    private readonly analysis: AnalysisService,
    private readonly requirements: RequirementsService,
  ) {}

  @Get('scripts/:id/analysis')
  getAnalysis(@Param('id', ParseUUIDPipe) id: string) {
    return this.analysis.getAnalysis(id);
  }

  @Post('scripts/:id/requirements')
  create(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateRequirementDto) {
    return this.requirements.create(id, dto);
  }

  @Patch('requirements/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRequirementDto) {
    return this.requirements.update(id, dto);
  }

  @Delete('requirements/:id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.requirements.remove(id);
  }

  @Post('requirements/:id/rematch')
  @HttpCode(200)
  rematch(@Param('id', ParseUUIDPipe) id: string) {
    return this.requirements.rematch(id);
  }

  @Put('requirements/:id/selection')
  setSelection(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SelectionDto) {
    return this.requirements.setSelection(id, dto);
  }
}
