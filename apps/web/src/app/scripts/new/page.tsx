'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { scripts, ApiError } from '@/lib/api';
import { fmtBytes } from '@/lib/format';
import { Banner, Button } from '@/components/ui';
import { ConfirmModal } from '@/components/Modal';
import { useToast } from '@/components/Toast';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ['txt', 'pdf', 'docx'];
const FILE_HELP = 'PDF, DOCX, TXT 파일을 올릴 수 있습니다.';

type Errors = Partial<Record<'file' | 'title' | 'productionCompany' | 'period', string>>;

export default function NewScriptPage() {
  const router = useRouter();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const dirty = !!(file || title || company || start || end);

  function pick(f: File | undefined) {
    if (!f) return;
    const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED.includes(ext)) {
      setFile(null);
      setErrors((e) => ({ ...e, file: 'PDF, DOCX, TXT 파일만 올릴 수 있습니다. 다른 형식이면 변환 후 다시 올려 주세요.' }));
      return;
    }
    if (f.size > MAX_BYTES) {
      setFile(null);
      setErrors((e) => ({ ...e, file: '파일이 10MB를 넘습니다. 파일을 나누거나 용량을 줄여 다시 올려 주세요.' }));
      return;
    }
    setErrors((e) => ({ ...e, file: undefined }));
    setFile(f);
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const e: Errors = {};
    if (!file) e.file = errors.file ?? '대본 파일을 선택해 주세요.';
    if (!title.trim()) e.title = '작품명을 입력해 주세요.';
    if (!company.trim()) e.productionCompany = '제작사를 입력해 주세요.';
    if (start && end && end < start) e.period = '종료일이 시작일보다 앞섭니다.';
    setErrors(e);
    setServerError(null);
    const first = Object.keys(e)[0];
    if (first) {
      document.getElementById(first === 'file' ? 'pick' : `f-${first}`)?.focus();
      return;
    }
    const form = new FormData();
    form.set('file', file!);
    form.set('title', title.trim());
    form.set('productionCompany', company.trim());
    if (start) form.set('shootStart', start);
    if (end) form.set('shootEnd', end);
    setBusy(true);
    try {
      const created = await scripts.upload(form);
      toast('업로드했습니다. 분석을 시작합니다.');
      router.push(`/scripts/${created.id}`);
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && [400, 413, 415].includes(err.status)) setErrors({ file: err.message });
      else setServerError('업로드하지 못했습니다. 입력한 내용은 그대로 두었습니다. 다시 시도해 주세요.');
    }
  }

  return (
    <div className="page">
      <div className="crumb"><Link href="/scripts">대본 목록</Link></div>
      <div className="head"><h2>대본 업로드</h2></div>
      {serverError && <Banner tone="bad">{serverError}</Banner>}
      <div className="upload-grid">
        <form className="panel upload-form" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="f-file">대본 파일 (필수)</label>
            {file ? (
              <div className="filerow">
                <span aria-hidden>📄</span>
                <span style={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{file.name}</span>
                <span className="muted small">{fmtBytes(file.size)}</span>
                <span className="bar"><i style={busy ? undefined : { width: '100%' }} /></span>
                <Button variant="ghost" size="sm" aria-label="파일 삭제" disabled={busy} onClick={() => setFile(null)}>삭제</Button>
              </div>
            ) : (
              <div
                className={`drop${drag ? ' over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
              >
                <div>파일을 여기에 끌어다 놓거나</div>
                <div><Button id="pick" size="sm" onClick={() => inputRef.current?.click()}>파일 선택</Button></div>
              </div>
            )}
            <input
              ref={inputRef}
              id="f-file"
              type="file"
              accept=".pdf,.docx,.txt"
              hidden
              onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }}
            />
            {errors.file ? <div className="err" role="alert">{errors.file}</div> : <div className="help">{FILE_HELP}</div>}
          </div>

          <div className="field">
            <label htmlFor="f-title">작품명 (필수)</label>
            <input id="f-title" className="inp" maxLength={200} value={title} aria-invalid={!!errors.title} aria-describedby={errors.title ? 'e-title' : undefined} onChange={(e) => setTitle(e.target.value)} />
            {errors.title && <div id="e-title" className="err">{errors.title}</div>}
          </div>

          <div className="field">
            <label htmlFor="f-productionCompany">제작사 (필수)</label>
            <input id="f-productionCompany" className="inp" maxLength={200} value={company} aria-invalid={!!errors.productionCompany} aria-describedby={errors.productionCompany ? 'e-co' : undefined} onChange={(e) => setCompany(e.target.value)} />
            {errors.productionCompany && <div id="e-co" className="err">{errors.productionCompany}</div>}
          </div>

          <div className="field">
            <label htmlFor="f-period">촬영 예정 기간</label>
            <div className="two">
              <input id="f-period" type="date" className="inp" aria-label="촬영 시작일" value={start} onChange={(e) => setStart(e.target.value)} />
              <span>~</span>
              <input type="date" className="inp" aria-label="촬영 종료일" value={end} min={start || undefined} aria-invalid={!!errors.period} onChange={(e) => setEnd(e.target.value)} />
            </div>
            {errors.period ? <div className="err">{errors.period}</div> : <div className="help">알고 있다면 입력하세요. 비워 두면 대본에서 일정 단서를 찾아봅니다.</div>}
          </div>

          <div className="form-foot">
            <Button onClick={() => (dirty ? setConfirmLeave(true) : router.push('/scripts'))}>취소</Button>
            <Button variant="primary" type="submit" loading={busy}>업로드</Button>
          </div>
        </form>

        <aside className="aside">
          <p><b>올릴 수 있는 파일</b><br />PDF, DOCX, TXT<br />파일당 최대 10MB</p>
          <p>업로드하면 바로 분석이 시작됩니다. 분석 중에도 다른 화면으로 이동할 수 있습니다.</p>
          <p>대본은 기밀 자료로 취급됩니다. 삭제하면 원본과 분석 결과가 함께 삭제됩니다.</p>
        </aside>
      </div>

      {confirmLeave && (
        <ConfirmModal
          title="입력한 내용이 사라집니다"
          body="입력한 내용이 사라집니다. 나갈까요?"
          confirmLabel="나가기"
          cancelLabel="계속 입력"
          onConfirm={() => router.push('/scripts')}
          onClose={() => setConfirmLeave(false)}
        />
      )}
    </div>
  );
}
