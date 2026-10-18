import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function run(err: unknown) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = { switchToHttp: () => ({ getResponse: () => ({ status }) }) };
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  new AllExceptionsFilter().catch(err, host as never);
  return { status: status.mock.calls[0][0], body: json.mock.calls[0][0] };
}

describe('AllExceptionsFilter', () => {
  it('검증 오류: message 배열 유지', () => {
    const r = run(new BadRequestException(['title should not be empty']));
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ statusCode: 400, error: 'Bad Request', message: ['title should not be empty'] });
  });
  it('문자열 메시지', () => {
    expect(run(new NotFoundException('차량을 찾을 수 없습니다.')).body).toEqual({
      statusCode: 404, error: 'Not Found', message: '차량을 찾을 수 없습니다.',
    });
  });
  it('알 수 없는 오류는 500 + 내부 메시지 비노출', () => {
    const r = run(new Error('secret db detail'));
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ statusCode: 500, error: 'Internal Server Error', message: '서버 오류가 발생했습니다.' });
  });
});
