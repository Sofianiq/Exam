-- =====================================================================
--  نظام إدارة اللجنة الامتحانية
--  كلية التقنيات الصحية والطبية — جامعة السراج الأهلية
--
--  مخطط قاعدة البيانات (Supabase / PostgreSQL 15+)
--  التشغيل: Supabase Dashboard ← SQL Editor ← الصق الملف كاملاً ← Run
--  الملف قابل لإعادة التشغيل بأمان (لا يحذف البيانات الموجودة).
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 1) الجداول
-- ---------------------------------------------------------------------

create table if not exists public.departments (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  code         text not null unique,
  has_evening  boolean not null default false,
  stages       smallint not null default 4 check (stages between 1 and 6),
  entry_open   boolean not null default true,
  sort         int not null default 0,
  created_at   timestamptz not null default now()
);

create table if not exists public.academic_years (
  id          uuid primary key default gen_random_uuid(),
  label       text not null unique check (label ~ '^\d{4}-\d{4}$'),
  created_at  timestamptz not null default now()
);

create table if not exists public.profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  username              text not null unique,
  full_name             text not null,
  title                 text,
  role                  text not null check (role in ('admin','dean','assistant_dean','committee','head','teacher')),
  department_id         uuid references public.departments (id) on delete set null,
  active                boolean not null default true,
  must_change_password  boolean not null default true,
  created_at            timestamptz not null default now(),
  created_by            uuid
);

create table if not exists public.settings (
  id               int primary key default 1 check (id = 1),
  university_name  text not null default 'جامعة السراج الأهلية',
  college_name     text not null default 'كلية التقنيات الصحية والطبية',
  entry_open       boolean not null default true,
  pass_mark        numeric(5,2) not null default 50,
  rounding         text not null default 'round' check (rounding in ('none','round','ceil')),
  grade_scale      jsonb not null default '[{"min":90,"label":"امتياز"},{"min":80,"label":"جيد جداً"},{"min":70,"label":"جيد"},{"min":60,"label":"متوسط"},{"min":50,"label":"مقبول"},{"min":0,"label":"ضعيف"}]',
  average_mode     text not null default 'weighted' check (average_mode in ('simple','weighted')),
  idle_minutes     int not null default 60 check (idle_minutes between 5 and 600),
  current_year_id  uuid references public.academic_years (id) on delete set null,
  updated_at       timestamptz not null default now()
);

create table if not exists public.students (
  id             uuid primary key default gen_random_uuid(),
  year_id        uuid not null references public.academic_years (id) on delete cascade,
  department_id  uuid not null references public.departments (id) on delete cascade,
  stage          smallint not null check (stage between 1 and 6),
  shift          text not null check (shift in ('morning','evening')),
  seq            int not null,
  full_name      text not null check (length(trim(full_name)) > 0),
  status         text not null default 'active' check (status in ('active','withdrawn','postponed')),
  notes          text,
  created_at     timestamptz not null default now(),
  unique (year_id, department_id, stage, shift, full_name)
);
create index if not exists students_class_idx on public.students (year_id, department_id, stage, shift, seq);

create table if not exists public.subjects (
  id                uuid primary key default gen_random_uuid(),
  year_id           uuid not null references public.academic_years (id) on delete cascade,
  department_id     uuid not null references public.departments (id) on delete cascade,
  stage             smallint not null check (stage between 1 and 6),
  shift             text not null check (shift in ('morning','evening')),
  term              smallint not null check (term in (1,2)),
  name              text not null check (length(trim(name)) > 0),
  code              text,
  units             numeric(4,1),
  teacher_ids       uuid[] not null default '{}',
  coursework_max    numeric(5,2) not null default 40,
  cw_practical_max  numeric(5,2) not null default 15,
  practical_max     numeric(5,2) not null default 25,
  final_max         numeric(5,2) generated always as (100 - coursework_max - practical_max) stored,
  status            text not null default 'draft' check (status in ('draft','submitted','returned','approved')),
  status_note       text,
  submitted_at      timestamptz,
  submitted_by      uuid,
  reviewed_at       timestamptz,
  reviewed_by       uuid,
  sort              int not null default 0,
  created_at        timestamptz not null default now(),
  check (coursework_max >= 0 and practical_max >= 0 and coursework_max + practical_max <= 100),
  check (cw_practical_max >= 0 and cw_practical_max <= coursework_max),
  unique (year_id, department_id, stage, shift, term, name)
);
create index if not exists subjects_class_idx on public.subjects (year_id, department_id, stage, shift, term);
create index if not exists subjects_teachers_idx on public.subjects using gin (teacher_ids);

create table if not exists public.grades (
  subject_id       uuid not null references public.subjects (id) on delete cascade,
  student_id       uuid not null references public.students (id) on delete cascade,
  cw_theory        numeric(5,2),
  cw_practical     numeric(5,2),
  final_practical  numeric(5,2),
  final_theory     numeric(5,2),
  special          text check (special in ('absent','postponed','banned')),
  note             text,
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  primary key (subject_id, student_id)
);
create index if not exists grades_student_idx on public.grades (student_id);

-- الخطة الدراسية لكل قسم (تُستورد منها المواد في كل سنة دراسية)
create table if not exists public.curriculum (
  id               uuid primary key default gen_random_uuid(),
  department_id    uuid not null references public.departments (id) on delete cascade,
  stage            smallint not null check (stage between 1 and 6),
  term             smallint not null check (term in (1,2)),
  sort             int not null default 0,
  name             text not null check (length(trim(name)) > 0),
  name_en          text,
  category         text,
  language         text,
  theory_hours     numeric(4,1) not null default 0,
  practical_hours  numeric(4,1) not null default 0,
  units            numeric(4,1) not null default 0,
  created_at       timestamptz not null default now(),
  unique (department_id, stage, term, name)
);

-- ترقيات الإصدار الثاني: الدور الثاني، اسم رئيس القسم، قواعد النتيجة
alter table public.departments add column if not exists head_name text;
alter table public.settings add column if not exists second_round_cap numeric(5,2);
alter table public.settings add column if not exists max_failed_subjects int not null default 2;
alter table public.grades add column if not exists r2_final_practical numeric(5,2);
alter table public.grades add column if not exists r2_final_theory numeric(5,2);
alter table public.grades add column if not exists r2_special text check (r2_special in ('absent','postponed','banned'));
alter table public.subjects add column if not exists r2_status text not null default 'draft'
  check (r2_status in ('draft','submitted','returned','approved'));
alter table public.subjects add column if not exists r2_note text;
alter table public.subjects add column if not exists r2_submitted_at timestamptz;
alter table public.subjects add column if not exists r2_reviewed_at timestamptz;
alter table public.subjects add column if not exists r2_reviewed_by uuid;

-- ترقيات الإصدار الثالث: المواد التقويمية (الوزارية)، حجب الدرجات عن التدريسيين، الإعلانات
alter table public.subjects add column if not exists ministerial boolean not null default false;
alter table public.subjects add column if not exists final_min numeric(5,2);
alter table public.curriculum add column if not exists ministerial boolean not null default false;
alter table public.settings add column if not exists hide_grades_when_closed boolean not null default true;
do $$ begin
  alter table public.subjects add constraint subjects_final_min_check
    check (final_min is null or (final_min >= 0 and final_min <= 100 - coursework_max));
exception when duplicate_object then null; end $$;

create table if not exists public.announcements (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (length(trim(title)) > 0),
  body           text not null default '',
  level          text not null default 'info' check (level in ('info','important','urgent')),
  department_id  uuid references public.departments (id) on delete cascade,
  audience       text not null default 'all' check (audience in ('all','teachers','heads')),
  pinned         boolean not null default false,
  expires_at     timestamptz,
  created_by     uuid default auth.uid(),
  created_by_name text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists announcements_created_idx on public.announcements (created_at desc);

create table if not exists public.audit_log (
  id             bigint generated always as identity primary key,
  at             timestamptz not null default now(),
  user_id        uuid,
  user_name      text,
  action         text not null,
  entity         text,
  entity_id      text,
  department_id  uuid,
  summary        text,
  details        jsonb
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);
create index if not exists audit_log_dept_idx on public.audit_log (department_id, at desc);

-- ---------------------------------------------------------------------
-- 2) دوال مساعدة للصلاحيات
-- ---------------------------------------------------------------------

create or replace function public.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.active
$$;

create or replace function public.my_department() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.department_id from public.profiles p where p.id = auth.uid() and p.active
$$;

-- الإدارة العليا: مدير النظام، العميد، معاون العميد
create or replace function public.is_super() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role() in ('admin','dean','assistant_dean'), false)
$$;

-- من يرى كل الأقسام (الإدارة العليا + اللجنة الامتحانية)
create or replace function public.can_view_all() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role() in ('admin','dean','assistant_dean','committee'), false)
$$;

create or replace function public.can_manage_department(p_department_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_super()
      or (public.my_role() = 'head' and public.my_department() = p_department_id)
$$;

create or replace function public.is_class_teacher(p_year uuid, p_dept uuid, p_stage smallint, p_shift text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.subjects s
    where s.year_id = p_year and s.department_id = p_dept and s.stage = p_stage and s.shift = p_shift
      and auth.uid() = any (s.teacher_ids)
  )
$$;

-- هل يملك المستخدم حق الكتابة في درجات المادة (بغض النظر عن القفل والحالة)
create or replace function public.can_write_subject(p_subject_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.subjects s
    where s.id = p_subject_id
      and ( public.is_super()
         or (public.my_role() = 'head' and s.department_id = public.my_department())
         or (public.my_role() = 'teacher' and auth.uid() = any (s.teacher_ids)) )
  )
$$;

-- سبب منع تعديل الدرجات (null = مسموح)
create or replace function public.grade_edit_block_reason(p_subject_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.subjects;
  v_role text := public.my_role();
  v_global boolean;
  v_dept boolean;
begin
  select * into s from public.subjects where id = p_subject_id;
  if not found then return 'المادة غير موجودة'; end if;
  if v_role is null then return 'الحساب غير مفعل'; end if;
  if not public.can_write_subject(p_subject_id) then return 'ليست لديك صلاحية على درجات هذه المادة'; end if;
  if public.is_super() then return null; end if;
  select entry_open into v_global from public.settings where id = 1;
  select entry_open into v_dept from public.departments where id = s.department_id;
  if not coalesce(v_global, true) then return 'إدخال الدرجات مغلق حالياً من قبل الإدارة'; end if;
  if not coalesce(v_dept, true) then return 'إدخال الدرجات مغلق لهذا القسم'; end if;
  if s.status = 'submitted' then return 'القائمة مرسلة إلى اللجنة الامتحانية ولا يمكن تعديلها'; end if;
  if s.status = 'approved' then return 'القائمة معتمدة ولا يمكن تعديلها'; end if;
  return null;
end $$;

-- سبب منع تعديل درجات الدور الثاني (null = مسموح)
create or replace function public.grade_r2_block_reason(p_subject_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.subjects;
  v_global boolean;
  v_dept boolean;
begin
  select * into s from public.subjects where id = p_subject_id;
  if not found then return 'المادة غير موجودة'; end if;
  if public.my_role() is null then return 'الحساب غير مفعل'; end if;
  if not public.can_write_subject(p_subject_id) then return 'ليست لديك صلاحية على درجات هذه المادة'; end if;
  if s.status <> 'approved' then return 'يجب اعتماد نتائج الدور الأول قبل إدخال درجات الدور الثاني'; end if;
  if public.is_super() then return null; end if;
  select entry_open into v_global from public.settings where id = 1;
  select entry_open into v_dept from public.departments where id = s.department_id;
  if not coalesce(v_global, true) then return 'إدخال الدرجات مغلق حالياً من قبل الإدارة'; end if;
  if not coalesce(v_dept, true) then return 'إدخال الدرجات مغلق لهذا القسم'; end if;
  if s.r2_status = 'submitted' then return 'قائمة الدور الثاني مرسلة إلى اللجنة الامتحانية ولا يمكن تعديلها'; end if;
  if s.r2_status = 'approved' then return 'قائمة الدور الثاني معتمدة ولا يمكن تعديلها'; end if;
  return null;
end $$;

-- حجب الدرجات عن التدريسي عند غلق الإدخال (عام أو للقسم) إن فُعّل ذلك في الإعدادات:
-- تنتهي مهمة التدريسي بتسليم الدرجات، وما بعدها سري لا يطّلع عليه
create or replace function public.grades_hidden_for_me(p_subject_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.my_role() = 'teacher', false)
     and coalesce((select hide_grades_when_closed from public.settings where id = 1), true)
     and exists (
       select 1 from public.subjects s join public.departments d on d.id = s.department_id
       where s.id = p_subject_id
         and (not coalesce((select entry_open from public.settings where id = 1), true) or not d.entry_open)
     )
$$;

-- من يقرأ الإعلان: الإدارة واللجنة كل الإعلانات، وغيرهم إعلانات الكلية العامة وإعلانات أقسامهم غير المنتهية
create or replace function public.can_read_announcement(a public.announcements) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_view_all()
      or a.created_by = auth.uid()
      or ( (a.expires_at is null or a.expires_at > now())
       and ( a.department_id is null
          or a.department_id = public.my_department()
          or exists (select 1 from public.subjects s where s.department_id = a.department_id and auth.uid() = any (s.teacher_ids)) )
       and ( a.audience = 'all'
          or (a.audience = 'teachers' and public.my_role() in ('teacher','head'))
          or (a.audience = 'heads' and public.my_role() = 'head') ) )
$$;

-- ---------------------------------------------------------------------
-- 3) حساب الدرجات
-- ---------------------------------------------------------------------

create or replace function public.apply_rounding(p numeric) returns numeric
language sql stable set search_path = '' as $$
  select case (select rounding from public.settings where id = 1)
           when 'round' then round(p)
           when 'ceil'  then ceil(p)
           else p end
$$;

-- المجموع النهائي (null إذا كانت الدرجة ناقصة أو للطالب حالة خاصة)
create or replace function public.grade_total(s public.subjects, g public.grades) returns numeric
language sql stable set search_path = '' as $$
  select case
    when g.subject_id is null or g.special is not null then null
    when (s.coursework_max - s.cw_practical_max > 0 and g.cw_theory is null)
      or (s.cw_practical_max > 0 and g.cw_practical is null)
      or (s.practical_max > 0 and g.final_practical is null)
      or (s.final_max > 0 and g.final_theory is null) then null
    else public.apply_rounding(coalesce(g.cw_theory,0) + coalesce(g.cw_practical,0)
                             + coalesce(g.final_practical,0) + coalesce(g.final_theory,0))
  end
$$;

-- هل الطالب ناجح في الدور الأول؟ المجموع ≥ درجة النجاح، وفي المادة التقويمية (الوزارية)
-- يُشترط أيضاً بلوغ الحد الأدنى في الامتحان النهائي (مثلاً 30 من 60). null = الدرجات غير مكتملة
create or replace function public.grade_passed(s public.subjects, g public.grades) returns boolean
language sql stable set search_path = '' as $$
  select case
    when public.grade_total(s, g) is null then null
    else public.grade_total(s, g) >= (select pass_mark from public.settings where id = 1)
     and (s.final_min is null or coalesce(g.final_practical,0) + coalesce(g.final_theory,0) >= s.final_min)
  end
$$;

-- مجموع الدور الثاني: السعي ثابت + درجات الامتحان النهائي للدور الثاني
-- (يُطبق سقف الدور الثاني إن وُجد، إلا للمؤجل بعذر لأن دوره الثاني يُعد دوراً أول)
create or replace function public.grade_r2_total(s public.subjects, g public.grades) returns numeric
language sql stable set search_path = '' as $$
  select case
    when g.subject_id is null or g.r2_special is not null then null
    when (s.coursework_max - s.cw_practical_max > 0 and g.cw_theory is null)
      or (s.cw_practical_max > 0 and g.cw_practical is null)
      or (s.practical_max > 0 and g.r2_final_practical is null)
      or (s.final_max > 0 and g.r2_final_theory is null) then null
    else least(
      public.apply_rounding(coalesce(g.cw_theory,0) + coalesce(g.cw_practical,0)
                          + coalesce(g.r2_final_practical,0) + coalesce(g.r2_final_theory,0)),
      case when g.special = 'postponed' then 100
           else coalesce((select second_round_cap from public.settings where id = 1), 100) end)
  end
$$;

-- ---------------------------------------------------------------------
-- 4) سجل العمليات
-- ---------------------------------------------------------------------

-- تعمل بصلاحيات المستدعي: تُستدعى فقط من داخل دوال النظام الموثوقة والقوادح،
-- ولا يستطيع أي مستخدم كتابة سجل مزيف مباشرة لأنه لا يملك صلاحية الإضافة على audit_log
create or replace function public.write_audit(
  p_action text, p_entity text, p_entity_id text, p_department_id uuid, p_summary text, p_details jsonb
) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.audit_log (user_id, user_name, action, entity, entity_id, department_id, summary, details)
  values (auth.uid(),
          coalesce((select full_name from public.profiles where id = auth.uid()), 'النظام'),
          p_action, p_entity, p_entity_id, p_department_id, p_summary, p_details);
end $$;

-- عمليات يسجلها التطبيق نفسه (الدخول، الخروج، التصدير، الطباعة)
create or replace function public.log_client_event(p_action text, p_summary text default null, p_details jsonb default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return; end if;
  if p_action not in ('auth.login','auth.logout','report.export','report.print','backup.export') then
    raise exception 'نوع عملية غير مسموح';
  end if;
  perform public.write_audit(p_action, 'session', null, public.my_department(), p_summary, p_details);
end $$;

-- ---------------------------------------------------------------------
-- 5) القوادح (Triggers)
-- ---------------------------------------------------------------------

-- 5.1 حماية وتدقيق الدرجات
create or replace function public.grades_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  s public.subjects;
  st public.students;
  v_reason text;
  v_cw_theory_max numeric;
  v_r1 boolean;
  v_r2 boolean;
  v_total numeric;
  v_has_reason boolean := coalesce(trim(current_setting('app.change_reason', true)), '') <> '';
begin
  -- الحذف المتسلسل (عند حذف مادة أو طالب أو سنة) تم التحقق من صلاحيته على الجدول الأصل
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;

  -- في عملية الحفظ (insert ... on conflict) إذا كان السجل موجوداً فالتحقق يتم في قادح التعديل
  -- الذي يرى القيم القديمة والجديدة معاً
  if tg_op = 'INSERT' and exists (select 1 from public.grades g
                                  where g.subject_id = new.subject_id and g.student_id = new.student_id) then
    if not public.can_write_subject(new.subject_id) then
      raise exception 'ليست لديك صلاحية على درجات هذه المادة' using errcode = '42501';
    end if;
    return new;
  end if;

  -- ما الذي تغيّر: درجات الدور الأول أم الدور الثاني؟ (لكل منهما صلاحياته وحالته)
  if tg_op = 'UPDATE' then
    v_r1 := (old.cw_theory, old.cw_practical, old.final_practical, old.final_theory, old.special, old.note)
            is distinct from (new.cw_theory, new.cw_practical, new.final_practical, new.final_theory, new.special, new.note);
    v_r2 := (old.r2_final_practical, old.r2_final_theory, old.r2_special)
            is distinct from (new.r2_final_practical, new.r2_final_theory, new.r2_special);
  elsif tg_op = 'INSERT' then
    v_r1 := true;
    v_r2 := (new.r2_final_practical, new.r2_final_theory, new.r2_special) is distinct from (null::numeric, null::numeric, null::text);
  else
    v_r1 := true;
    v_r2 := false;
  end if;

  select * into s from public.subjects where id = coalesce(new.subject_id, old.subject_id);

  if v_r1 then
    v_reason := public.grade_edit_block_reason(s.id);
    if v_reason is not null then raise exception '%', v_reason using errcode = '42501'; end if;
    if s.status = 'approved' and not v_has_reason then
      raise exception 'تعديل قائمة معتمدة يتطلب ذكر سبب التعديل' using errcode = '22023';
    end if;
  end if;
  if v_r2 then
    v_reason := public.grade_r2_block_reason(s.id);
    if v_reason is not null then raise exception '%', v_reason using errcode = '42501'; end if;
    if s.r2_status = 'approved' and not v_has_reason then
      raise exception 'تعديل قائمة الدور الثاني المعتمدة يتطلب ذكر سبب التعديل' using errcode = '22023';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;

  select * into st from public.students where id = new.student_id;
  if not found or st.year_id <> s.year_id or st.department_id <> s.department_id
     or st.stage <> s.stage or st.shift <> s.shift then
    raise exception 'الطالب لا ينتمي إلى صف هذه المادة' using errcode = '22023';
  end if;

  -- تجاهل المكونات غير المستخدمة في هذه المادة
  if s.cw_practical_max = 0 then new.cw_practical := null; end if;
  if s.practical_max = 0 then new.final_practical := null; end if;
  if s.final_max = 0 then new.final_theory := null; end if;
  if s.practical_max = 0 then new.r2_final_practical := null; end if;
  if s.final_max = 0 then new.r2_final_theory := null; end if;
  v_cw_theory_max := s.coursework_max - s.cw_practical_max;
  if v_cw_theory_max = 0 then new.cw_theory := null; end if;

  if new.cw_theory < 0 or new.cw_theory > v_cw_theory_max then
    raise exception 'درجة السعي (النظري) يجب أن تكون بين 0 و %', v_cw_theory_max using errcode = '22023';
  end if;
  if new.cw_practical < 0 or new.cw_practical > s.cw_practical_max then
    raise exception 'درجة السعي (العملي) يجب أن تكون بين 0 و %', s.cw_practical_max using errcode = '22023';
  end if;
  if new.final_practical < 0 or new.final_practical > s.practical_max then
    raise exception 'درجة العملي النهائي يجب أن تكون بين 0 و %', s.practical_max using errcode = '22023';
  end if;
  if new.final_theory < 0 or new.final_theory > s.final_max then
    raise exception 'درجة الامتحان النهائي يجب أن تكون بين 0 و %', s.final_max using errcode = '22023';
  end if;
  if new.r2_final_practical < 0 or new.r2_final_practical > s.practical_max then
    raise exception 'درجة العملي النهائي (الدور الثاني) يجب أن تكون بين 0 و %', s.practical_max using errcode = '22023';
  end if;
  if new.r2_final_theory < 0 or new.r2_final_theory > s.final_max then
    raise exception 'درجة الامتحان النهائي (الدور الثاني) يجب أن تكون بين 0 و %', s.final_max using errcode = '22023';
  end if;

  -- الدور الثاني للطلبة غير الناجحين في الدور الأول فقط (السعي الفصلي ثابت)
  if (new.r2_final_practical, new.r2_final_theory, new.r2_special) is distinct from (null::numeric, null::numeric, null::text) then
    v_total := public.grade_total(s, new);
    if new.special is null and v_total is null then
      raise exception 'درجات الدور الأول للطالب غير مكتملة' using errcode = '22023';
    end if;
    if new.special is null and public.grade_passed(s, new) then
      raise exception 'الطالب ناجح في الدور الأول ولا يحتاج إلى دور ثانٍ' using errcode = '22023';
    end if;
  end if;

  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists grades_guard on public.grades;
create trigger grades_guard before insert or update or delete on public.grades
  for each row execute function public.grades_guard();

create or replace function public.grades_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  s public.subjects;
  v_student text;
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return null; end if;
  if tg_op = 'UPDATE' and (old.cw_theory, old.cw_practical, old.final_practical, old.final_theory, old.special, old.note,
                           old.r2_final_practical, old.r2_final_theory, old.r2_special)
       is not distinct from (new.cw_theory, new.cw_practical, new.final_practical, new.final_theory, new.special, new.note,
                             new.r2_final_practical, new.r2_final_theory, new.r2_special) then
    return null;
  end if;
  select * into s from public.subjects where id = coalesce(new.subject_id, old.subject_id);
  select full_name into v_student from public.students where id = coalesce(new.student_id, old.student_id);
  if tg_op <> 'INSERT' then
    v_old := jsonb_build_object('cw_theory', old.cw_theory, 'cw_practical', old.cw_practical,
      'final_practical', old.final_practical, 'final_theory', old.final_theory, 'special', old.special, 'note', old.note,
      'r2_final_practical', old.r2_final_practical, 'r2_final_theory', old.r2_final_theory, 'r2_special', old.r2_special);
  end if;
  if tg_op <> 'DELETE' then
    v_new := jsonb_build_object('cw_theory', new.cw_theory, 'cw_practical', new.cw_practical,
      'final_practical', new.final_practical, 'final_theory', new.final_theory, 'special', new.special, 'note', new.note,
      'r2_final_practical', new.r2_final_practical, 'r2_final_theory', new.r2_final_theory, 'r2_special', new.r2_special);
  end if;
  perform public.write_audit(
    case tg_op when 'INSERT' then 'grade.create' when 'UPDATE' then 'grade.update' else 'grade.delete' end,
    'grade', coalesce(new.subject_id, old.subject_id)::text, s.department_id,
    s.name || ' — ' || coalesce(v_student, ''),
    jsonb_build_object('subject_id', s.id, 'student_id', coalesce(new.student_id, old.student_id),
                       'old', v_old, 'new', v_new,
                       'reason', nullif(trim(coalesce(current_setting('app.change_reason', true), '')), '')));
  return null;
end $$;

drop trigger if exists grades_audit on public.grades;
create trigger grades_audit after insert or update or delete on public.grades
  for each row execute function public.grades_audit();

-- 5.2 حماية المواد
create or replace function public.subjects_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_has_grades boolean;
begin
  if tg_op = 'INSERT' then
    if coalesce(current_setting('app.status_rpc', true), '') <> 'on' then
      new.status := 'draft';
      new.status_note := null;
      new.submitted_at := null; new.submitted_by := null;
      new.reviewed_at := null;  new.reviewed_by := null;
      new.r2_status := 'draft'; new.r2_note := null;
      new.r2_submitted_at := null; new.r2_reviewed_at := null; new.r2_reviewed_by := null;
    end if;
    return new;
  end if;

  select exists (select 1 from public.grades g where g.subject_id = old.id
                 and (g.cw_theory is not null or g.cw_practical is not null or g.final_practical is not null
                      or g.final_theory is not null or g.special is not null
                      or g.r2_final_practical is not null or g.r2_final_theory is not null)) into v_has_grades;

  if tg_op = 'DELETE' then
    if v_has_grades and not public.is_super() then
      raise exception 'لا يمكن حذف مادة تحتوي على درجات. تواصل مع الإدارة.' using errcode = '42501';
    end if;
    return old;
  end if;

  -- UPDATE
  if coalesce(current_setting('app.status_rpc', true), '') <> 'on' and
     (new.status, new.status_note, new.submitted_at, new.submitted_by, new.reviewed_at, new.reviewed_by,
      new.r2_status, new.r2_note, new.r2_submitted_at, new.r2_reviewed_at, new.r2_reviewed_by)
       is distinct from (old.status, old.status_note, old.submitted_at, old.submitted_by, old.reviewed_at, old.reviewed_by,
                         old.r2_status, old.r2_note, old.r2_submitted_at, old.r2_reviewed_at, old.r2_reviewed_by) then
    raise exception 'تغيير حالة القائمة يتم من خلال أزرار الإرسال والتدقيق فقط' using errcode = '42501';
  end if;

  if (new.year_id, new.department_id, new.stage, new.shift) is distinct from (old.year_id, old.department_id, old.stage, old.shift)
     and v_has_grades then
    raise exception 'لا يمكن نقل مادة تحتوي على درجات إلى صف آخر' using errcode = '42501';
  end if;

  if (new.coursework_max, new.cw_practical_max, new.practical_max, new.final_min)
       is distinct from (old.coursework_max, old.cw_practical_max, old.practical_max, old.final_min) then
    if old.status in ('submitted','approved') and not public.is_super() then
      raise exception 'لا يمكن تعديل توزيع الدرجات لقائمة مرسلة أو معتمدة' using errcode = '42501';
    end if;
    if exists (select 1 from public.grades g where g.subject_id = old.id and (
         g.cw_theory > new.coursework_max - new.cw_practical_max
      or (new.cw_practical_max = 0 and g.cw_practical is not null)
      or g.cw_practical > new.cw_practical_max
      or (new.practical_max = 0 and g.final_practical is not null)
      or g.final_practical > new.practical_max
      or g.final_theory > 100 - new.coursework_max - new.practical_max)) then
      raise exception 'توزيع الدرجات الجديد لا يتوافق مع درجات مُدخلة مسبقاً. عدّل الدرجات أولاً.' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists subjects_guard on public.subjects;
create trigger subjects_guard before insert or update or delete on public.subjects
  for each row execute function public.subjects_guard();

create or replace function public.subjects_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'status' - 'status_note' - 'submitted_at' - 'submitted_by' - 'reviewed_at' - 'reviewed_by'
                           - 'r2_status' - 'r2_note' - 'r2_submitted_at' - 'r2_reviewed_at' - 'r2_reviewed_by')
                        = (to_jsonb(old) - 'status' - 'status_note' - 'submitted_at' - 'submitted_by' - 'reviewed_at' - 'reviewed_by'
                           - 'r2_status' - 'r2_note' - 'r2_submitted_at' - 'r2_reviewed_at' - 'r2_reviewed_by') then
    return null; -- تغيّر الحالة يُسجَّل في set_subject_status
  end if;
  perform public.write_audit(
    case tg_op when 'INSERT' then 'subject.create' when 'UPDATE' then 'subject.update' else 'subject.delete' end,
    'subject', coalesce(new.id, old.id)::text, coalesce(new.department_id, old.department_id),
    coalesce(new.name, old.name),
    case when tg_op = 'UPDATE' then jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
         else to_jsonb(coalesce(new, old)) end);
  return null;
end $$;

drop trigger if exists subjects_audit on public.subjects;
create trigger subjects_audit after insert or update or delete on public.subjects
  for each row execute function public.subjects_audit();

-- 5.3 حماية الطلبة
create or replace function public.students_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.full_name := regexp_replace(trim(new.full_name), '\s+', ' ', 'g');
    return new;
  end if;
  if exists (select 1 from public.grades g where g.student_id = old.id
             and (g.cw_theory is not null or g.cw_practical is not null or g.final_practical is not null
                  or g.final_theory is not null or g.special is not null)) then
    if tg_op = 'DELETE' and not public.is_super() then
      raise exception 'لا يمكن حذف طالب لديه درجات مسجلة. يمكنك تغيير حالته إلى منسحب أو مؤجل.' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and (new.year_id, new.department_id, new.stage, new.shift)
                            is distinct from (old.year_id, old.department_id, old.stage, old.shift) then
      raise exception 'لا يمكن نقل طالب لديه درجات إلى صف آخر' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.full_name := regexp_replace(trim(new.full_name), '\s+', ' ', 'g');
  return new;
end $$;

drop trigger if exists students_guard on public.students;
create trigger students_guard before insert or update or delete on public.students
  for each row execute function public.students_guard();

create or replace function public.students_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then return null; end if; -- الإضافة الجماعية تُسجَّل في add_students
  if tg_op = 'UPDATE' and (new.full_name, new.status, new.notes, new.year_id, new.department_id, new.stage, new.shift)
                          is not distinct from (old.full_name, old.status, old.notes, old.year_id, old.department_id, old.stage, old.shift) then
    return null; -- تغيير الترتيب فقط
  end if;
  perform public.write_audit(
    case tg_op when 'UPDATE' then 'student.update' else 'student.delete' end,
    'student', old.id::text, old.department_id, old.full_name,
    case when tg_op = 'UPDATE' then jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new)) else to_jsonb(old) end);
  return null;
end $$;

drop trigger if exists students_audit on public.students;
create trigger students_audit after update or delete on public.students
  for each row execute function public.students_audit();

-- 5.4 تدقيق الإعدادات والأقسام
create or replace function public.settings_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  if new.entry_open is distinct from old.entry_open then
    perform public.write_audit(case when new.entry_open then 'entry.open' else 'entry.close' end,
      'settings', null, null,
      case when new.entry_open then 'فتح إدخال الدرجات لجميع الأقسام' else 'غلق إدخال الدرجات لجميع الأقسام' end, null);
  end if;
  if (to_jsonb(new) - 'entry_open' - 'updated_at') is distinct from (to_jsonb(old) - 'entry_open' - 'updated_at') then
    perform public.write_audit('settings.update', 'settings', null, null, 'تعديل إعدادات النظام',
      jsonb_build_object('old', to_jsonb(old) - 'updated_at', 'new', to_jsonb(new) - 'updated_at'));
  end if;
  return new;
end $$;

drop trigger if exists settings_audit on public.settings;
create trigger settings_audit before update on public.settings
  for each row execute function public.settings_audit();

-- الإعلانات: تثبيت الكاتب واسمه، ومنع مقرر القسم من النشر خارج قسمه، وتسجيل العملية
create or replace function public.announcements_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform public.write_audit('announcement.delete', 'announcement', old.id::text, old.department_id, 'حذف إعلان: ' || old.title, null);
    return old;
  end if;
  if not public.is_super() and not (public.my_role() = 'head' and new.department_id is not distinct from public.my_department() and new.department_id is not null) then
    raise exception 'ليست لديك صلاحية نشر إعلان لهذه الجهة' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_by_name := (select coalesce(nullif(trim(coalesce(p.title, '') || ' ' || p.full_name), ''), p.full_name)
                            from public.profiles p where p.id = auth.uid());
    new.created_at := now();
    perform public.write_audit('announcement.create', 'announcement', new.id::text, new.department_id, 'نشر إعلان: ' || new.title, null);
  else
    new.created_by := old.created_by;
    new.created_by_name := old.created_by_name;
    new.created_at := old.created_at;
    perform public.write_audit('announcement.update', 'announcement', new.id::text, new.department_id, 'تعديل إعلان: ' || new.title, null);
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists announcements_guard on public.announcements;
create trigger announcements_guard before insert or update or delete on public.announcements
  for each row execute function public.announcements_guard();

create or replace function public.departments_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.entry_open is distinct from old.entry_open then
    perform public.write_audit(case when new.entry_open then 'entry.open' else 'entry.close' end,
      'department', new.id::text, new.id,
      case when new.entry_open then 'فتح إدخال الدرجات — ' else 'غلق إدخال الدرجات — ' end || new.name, null);
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'entry_open') is not distinct from (to_jsonb(old) - 'entry_open') then
    return null;
  end if;
  perform public.write_audit(
    case tg_op when 'INSERT' then 'department.create' when 'UPDATE' then 'department.update' else 'department.delete' end,
    'department', coalesce(new.id, old.id)::text, null, coalesce(new.name, old.name), null);
  return null;
end $$;

drop trigger if exists departments_audit on public.departments;
create trigger departments_audit after insert or update or delete on public.departments
  for each row execute function public.departments_audit();

-- ---------------------------------------------------------------------
-- 6) واجهات العمليات (RPC)
-- ---------------------------------------------------------------------

-- 6.1 حفظ مجموعة درجات دفعة واحدة
create or replace function public.save_grades(p_subject_id uuid, p_rows jsonb, p_reason text default null)
returns timestamptz
language plpgsql security invoker set search_path = '' as $$
declare v_block text;
begin
  -- رسالة واضحة بدل خطأ الصلاحيات العام عندما تكون الدرجات محجوبة عن التدريسي (الإدخال مغلق)
  if public.grades_hidden_for_me(p_subject_id) then
    v_block := public.grade_edit_block_reason(p_subject_id);
    raise exception '%', coalesce(v_block, 'إدخال الدرجات مغلق حالياً') using errcode = '42501';
  end if;
  if p_reason is not null and length(trim(p_reason)) > 0 then
    perform set_config('app.change_reason', trim(p_reason), true);
  end if;
  insert into public.grades as g (subject_id, student_id, cw_theory, cw_practical, final_practical, final_theory, special, note,
                                  r2_final_practical, r2_final_theory, r2_special)
  select p_subject_id, x.student_id, x.cw_theory, x.cw_practical, x.final_practical, x.final_theory,
         nullif(x.special, ''), nullif(trim(x.note), ''),
         x.r2_final_practical, x.r2_final_theory, nullif(x.r2_special, '')
  from jsonb_to_recordset(p_rows) as x(student_id uuid, cw_theory numeric, cw_practical numeric,
                                       final_practical numeric, final_theory numeric, special text, note text,
                                       r2_final_practical numeric, r2_final_theory numeric, r2_special text)
  on conflict (subject_id, student_id) do update set
    cw_theory = excluded.cw_theory,
    cw_practical = excluded.cw_practical,
    final_practical = excluded.final_practical,
    final_theory = excluded.final_theory,
    special = excluded.special,
    note = excluded.note,
    r2_final_practical = excluded.r2_final_practical,
    r2_final_theory = excluded.r2_final_theory,
    r2_special = excluded.r2_special;
  return now();
end $$;

-- 6.2 إضافة طلبة بالنسخ واللصق مع الحفاظ على التسلسل
create or replace function public.add_students(
  p_year_id uuid, p_department_id uuid, p_stage smallint, p_shift text, p_names text[]
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_seq int;
  v_name text;
  v_added int := 0;
  v_skipped text[] := '{}';
begin
  if not public.can_manage_department(p_department_id) then
    raise exception 'ليست لديك صلاحية إضافة طلبة لهذا القسم' using errcode = '42501';
  end if;
  select coalesce(max(seq), 0) into v_seq from public.students
   where year_id = p_year_id and department_id = p_department_id and stage = p_stage and shift = p_shift;
  foreach v_name in array p_names loop
    v_name := regexp_replace(trim(v_name), '\s+', ' ', 'g');
    continue when v_name = '';
    if exists (select 1 from public.students where year_id = p_year_id and department_id = p_department_id
               and stage = p_stage and shift = p_shift and full_name = v_name) then
      v_skipped := v_skipped || v_name;
      continue;
    end if;
    v_seq := v_seq + 1;
    insert into public.students (year_id, department_id, stage, shift, seq, full_name)
    values (p_year_id, p_department_id, p_stage, p_shift, v_seq, v_name);
    v_added := v_added + 1;
  end loop;
  if v_added > 0 then
    perform public.write_audit('student.import', 'class', null, p_department_id,
      'إضافة ' || v_added || ' طالب — المرحلة ' || p_stage || ' — ' || case p_shift when 'morning' then 'صباحي' else 'مسائي' end,
      jsonb_build_object('year_id', p_year_id, 'stage', p_stage, 'shift', p_shift, 'count', v_added));
  end if;
  return jsonb_build_object('added', v_added, 'skipped', to_jsonb(v_skipped));
end $$;

-- 6.3 إعادة ترتيب الطلبة يدوياً
create or replace function public.reorder_students(p_ids uuid[])
returns void
language plpgsql security invoker set search_path = '' as $$
begin
  update public.students s set seq = o.ord
  from unnest(p_ids) with ordinality as o(id, ord)
  where s.id = o.id;
end $$;

-- 6.4 تغيير حالة القائمة: إرسال / إعادة / اعتماد / إعادة فتح (للدور الأول أو الثاني)
drop function if exists public.set_subject_status(uuid, text, text);
create or replace function public.set_subject_status(
  p_subject_id uuid, p_status text, p_note text default null, p_round smallint default 1
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.subjects;
  v_role text := public.my_role();
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_reason text;
  v_cur text;
  v_label text;
begin
  select * into s from public.subjects where id = p_subject_id for update;
  if not found then raise exception 'المادة غير موجودة'; end if;
  if v_role is null then raise exception 'الحساب غير مفعل' using errcode = '42501'; end if;
  if p_round not in (1, 2) then raise exception 'دور امتحاني غير معروف'; end if;
  if p_round = 2 and s.status <> 'approved' then
    raise exception 'يجب اعتماد نتائج الدور الأول قبل إجراءات الدور الثاني' using errcode = '22023';
  end if;
  v_cur := case when p_round = 1 then s.status else s.r2_status end;
  v_label := case when p_round = 1 then '' else ' (الدور الثاني)' end;

  if p_status = 'submitted' then
    if v_cur not in ('draft','returned') then
      raise exception 'لا يمكن إرسال القائمة في حالتها الحالية' using errcode = '22023';
    end if;
    v_reason := case when p_round = 1 then public.grade_edit_block_reason(p_subject_id)
                     else public.grade_r2_block_reason(p_subject_id) end;
    if v_reason is not null then raise exception '%', v_reason using errcode = '42501'; end if;
  elsif p_status in ('approved','returned') then
    if v_role not in ('admin','dean','assistant_dean','committee') then
      raise exception 'التدقيق والاعتماد من صلاحية اللجنة الامتحانية والإدارة' using errcode = '42501';
    end if;
    if p_status = 'approved' and v_cur = 'approved' then
      raise exception 'القائمة معتمدة مسبقاً' using errcode = '22023';
    end if;
    if p_status = 'approved' and v_cur <> 'submitted' and v_role = 'committee' then
      raise exception 'لا يمكن اعتماد قائمة لم تُرسل بعد' using errcode = '22023';
    end if;
    if p_status = 'returned' and v_cur = 'approved' and not public.is_super() then
      raise exception 'إعادة فتح قائمة معتمدة من صلاحية الإدارة العليا فقط' using errcode = '42501';
    end if;
    if p_status = 'returned' and v_cur not in ('submitted','approved') then
      raise exception 'لا يمكن إعادة قائمة لم تُرسل' using errcode = '22023';
    end if;
    if p_status = 'returned' and v_note is null then
      raise exception 'يرجى كتابة ملاحظة توضح سبب الإعادة' using errcode = '22023';
    end if;
  elsif p_status = 'draft' then
    if not public.is_super() then
      raise exception 'إعادة القائمة إلى مسودة من صلاحية الإدارة العليا فقط' using errcode = '42501';
    end if;
  else
    raise exception 'حالة غير معروفة';
  end if;

  perform set_config('app.status_rpc', 'on', true);
  if p_round = 1 then
    update public.subjects set
      status = p_status,
      status_note = case when p_status = 'submitted' then status_note else v_note end,
      submitted_at = case when p_status = 'submitted' then now() else submitted_at end,
      submitted_by = case when p_status = 'submitted' then auth.uid() else submitted_by end,
      reviewed_at  = case when p_status in ('approved','returned') then now() else reviewed_at end,
      reviewed_by  = case when p_status in ('approved','returned') then auth.uid() else reviewed_by end
    where id = p_subject_id;
  else
    update public.subjects set
      r2_status = p_status,
      r2_note = case when p_status = 'submitted' then r2_note else v_note end,
      r2_submitted_at = case when p_status = 'submitted' then now() else r2_submitted_at end,
      r2_reviewed_at  = case when p_status in ('approved','returned') then now() else r2_reviewed_at end,
      r2_reviewed_by  = case when p_status in ('approved','returned') then auth.uid() else r2_reviewed_by end
    where id = p_subject_id;
  end if;
  perform set_config('app.status_rpc', 'off', true);

  perform public.write_audit('subject.' || p_status, 'subject', s.id::text, s.department_id,
    s.name || case p_status when 'submitted' then ' — إرسال إلى اللجنة'
                            when 'approved' then ' — اعتماد'
                            when 'returned' then ' — إعادة للتعديل'
                            else ' — إعادة إلى مسودة' end || v_label,
    jsonb_build_object('from', v_cur, 'to', p_status, 'note', v_note, 'round', p_round));
end $$;

-- 6.5 فتح / غلق إدخال الدرجات (للكل أو لقسم محدد)
create or replace function public.set_entry_open(p_open boolean, p_department_id uuid default null)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_super() then
    raise exception 'فتح وغلق الإدخال من صلاحية الإدارة العليا فقط' using errcode = '42501';
  end if;
  if p_department_id is null then
    update public.settings set entry_open = p_open where id = 1;
  else
    update public.departments set entry_open = p_open where id = p_department_id;
  end if;
end $$;

-- 6.6 نسخ المواد بين الصفوف (صباحي ← مسائي، أو من سنة سابقة)
create or replace function public.copy_subjects(
  p_from_year uuid, p_from_dept uuid, p_from_stage smallint, p_from_shift text, p_from_term smallint,
  p_to_year uuid, p_to_dept uuid, p_to_stage smallint, p_to_shift text, p_to_term smallint,
  p_with_teachers boolean default true
) returns int
language plpgsql security invoker set search_path = '' as $$
declare v_count int;
begin
  if not public.can_manage_department(p_to_dept) then
    raise exception 'ليست لديك صلاحية على القسم الهدف' using errcode = '42501';
  end if;
  insert into public.subjects (year_id, department_id, stage, shift, term, name, code, units, teacher_ids,
                               coursework_max, cw_practical_max, practical_max, sort, ministerial, final_min)
  select p_to_year, p_to_dept, p_to_stage, p_to_shift, p_to_term, s.name, s.code, s.units,
         case when p_with_teachers then s.teacher_ids else '{}'::uuid[] end,
         s.coursework_max, s.cw_practical_max, s.practical_max, s.sort, s.ministerial, s.final_min
  from public.subjects s
  where s.year_id = p_from_year and s.department_id = p_from_dept and s.stage = p_from_stage
    and s.shift = p_from_shift and s.term = p_from_term
  on conflict (year_id, department_id, stage, shift, term, name) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------------------------------------------------------------------
-- 7) إدارة الحسابات
--    اسم المستخدم يُحوَّل داخلياً إلى بريد وهمي: username@exam.local
-- ---------------------------------------------------------------------

create or replace function public._create_user(
  p_username text, p_password text, p_full_name text, p_role text, p_department_id uuid, p_title text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := gen_random_uuid();
  v_username text := lower(trim(p_username));
  v_email text;
begin
  -- حماية إضافية: عند الاستدعاء عبر واجهة الـ API يجب أن يملك المستخدم صلاحية إنشاء هذا الدور
  -- (حتى لو مُنحت صلاحية التنفيذ خطأً، مثلاً بعد استعادة نسخة احتياطية)
  if (session_user = 'authenticator' or coalesce(current_setting('request.jwt.claims', true), '') <> '')
     and not public.can_manage_role(p_role, p_department_id) then
    raise exception 'ليست لديك صلاحية إنشاء هذا النوع من الحسابات' using errcode = '42501';
  end if;
  if v_username !~ '^[a-z0-9][a-z0-9._-]{2,31}$' then
    raise exception 'اسم المستخدم يجب أن يتكون من 3 إلى 32 حرفاً إنجليزياً أو رقماً (يسمح بـ . _ -)' using errcode = '22023';
  end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'كلمة المرور يجب أن لا تقل عن 6 أحرف' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_full_name, ''))) < 3 then
    raise exception 'يرجى كتابة الاسم الكامل' using errcode = '22023';
  end if;
  if p_role not in ('admin','dean','assistant_dean','committee','head','teacher') then
    raise exception 'دور غير معروف' using errcode = '22023';
  end if;
  if p_role = 'head' and p_department_id is null then
    raise exception 'يجب تحديد القسم لحساب مقرر القسم' using errcode = '22023';
  end if;
  v_email := v_username || '@exam.local';
  if exists (select 1 from public.profiles where username = v_username)
     or exists (select 1 from auth.users where email = v_email) then
    raise exception 'اسم المستخدم "%" مستخدم مسبقاً', v_username using errcode = '23505';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf', 10)), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', trim(p_full_name)), now(), now(),
    '', '', '', '', '', '', '', ''
  );
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_uid, v_uid::text,
          jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
          'email', now(), now(), now());

  insert into public.profiles (id, username, full_name, title, role, department_id, created_by)
  values (v_uid, v_username, regexp_replace(trim(p_full_name), '\s+', ' ', 'g'), nullif(trim(coalesce(p_title, '')), ''),
          p_role, p_department_id, auth.uid());
  return v_uid;
end $$;

-- هل يحق للمستخدم الحالي إنشاء/إدارة حساب بهذا الدور؟
create or replace function public.can_manage_role(p_role text, p_department_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case public.my_role()
    when 'admin' then true
    when 'dean' then p_role <> 'admin'
    when 'assistant_dean' then p_role in ('committee','head','teacher')
    when 'head' then p_role = 'teacher' and p_department_id is not distinct from public.my_department()
    else false end
$$;

create or replace function public.can_manage_user(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = p_user_id
                 and p.id <> auth.uid()
                 and public.can_manage_role(p.role, p.department_id))
$$;

create or replace function public.create_account(
  p_username text, p_password text, p_full_name text, p_role text,
  p_department_id uuid default null, p_title text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid;
  v_dept uuid := p_department_id;
begin
  if public.my_role() = 'head' then v_dept := public.my_department(); end if;
  if not public.can_manage_role(p_role, v_dept) then
    raise exception 'ليست لديك صلاحية إنشاء هذا النوع من الحسابات' using errcode = '42501';
  end if;
  v_uid := public._create_user(p_username, p_password, p_full_name, p_role, v_dept, p_title);
  perform public.write_audit('user.create', 'profile', v_uid::text, v_dept,
    'إنشاء حساب: ' || trim(p_full_name) || ' (' || lower(trim(p_username)) || ')',
    jsonb_build_object('role', p_role));
  return v_uid;
end $$;

create or replace function public.update_account(
  p_user_id uuid, p_full_name text, p_title text, p_role text, p_department_id uuid, p_active boolean
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_old public.profiles;
  v_dept uuid := p_department_id;
begin
  select * into v_old from public.profiles where id = p_user_id;
  if not found then raise exception 'الحساب غير موجود'; end if;
  if public.my_role() = 'head' then v_dept := public.my_department(); end if;
  if not public.can_manage_user(p_user_id) or not public.can_manage_role(p_role, v_dept) then
    raise exception 'ليست لديك صلاحية تعديل هذا الحساب' using errcode = '42501';
  end if;
  if p_role = 'head' and v_dept is null then
    raise exception 'يجب تحديد القسم لحساب مقرر القسم' using errcode = '22023';
  end if;
  if v_old.role = 'admin' and (p_role <> 'admin' or not p_active)
     and (select count(*) from public.profiles where role = 'admin' and active) <= 1 then
    raise exception 'لا يمكن إلغاء آخر حساب مدير نظام' using errcode = '42501';
  end if;
  update public.profiles set
    full_name = regexp_replace(trim(p_full_name), '\s+', ' ', 'g'),
    title = nullif(trim(coalesce(p_title, '')), ''),
    role = p_role, department_id = v_dept, active = p_active
  where id = p_user_id;
  update auth.users set banned_until = case when p_active then null else now() + interval '100 years' end,
                        updated_at = now()
  where id = p_user_id;
  perform public.write_audit('user.update', 'profile', p_user_id::text, coalesce(v_dept, v_old.department_id),
    'تعديل حساب: ' || v_old.full_name,
    jsonb_build_object('old', to_jsonb(v_old), 'new', jsonb_build_object('full_name', p_full_name, 'title', p_title,
      'role', p_role, 'department_id', v_dept, 'active', p_active)));
end $$;

create or replace function public.reset_password(p_user_id uuid, p_password text)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_p public.profiles;
begin
  select * into v_p from public.profiles where id = p_user_id;
  if not found then raise exception 'الحساب غير موجود'; end if;
  if not public.can_manage_user(p_user_id) then
    raise exception 'ليست لديك صلاحية على هذا الحساب' using errcode = '42501';
  end if;
  if length(coalesce(p_password, '')) < 6 then
    raise exception 'كلمة المرور يجب أن لا تقل عن 6 أحرف' using errcode = '22023';
  end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)), updated_at = now()
  where id = p_user_id;
  update public.profiles set must_change_password = true where id = p_user_id;
  perform public.write_audit('user.reset_password', 'profile', p_user_id::text, v_p.department_id,
    'إعادة تعيين كلمة مرور: ' || v_p.full_name, null);
end $$;

create or replace function public.delete_account(p_user_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_p public.profiles;
begin
  select * into v_p from public.profiles where id = p_user_id;
  if not found then raise exception 'الحساب غير موجود'; end if;
  if public.my_role() not in ('admin','dean') or not public.can_manage_user(p_user_id) then
    raise exception 'حذف الحسابات من صلاحية مدير النظام والعميد فقط' using errcode = '42501';
  end if;
  if v_p.role = 'admin' and (select count(*) from public.profiles where role = 'admin' and active) <= 1 then
    raise exception 'لا يمكن حذف آخر حساب مدير نظام' using errcode = '42501';
  end if;
  update public.subjects set teacher_ids = array_remove(teacher_ids, p_user_id) where p_user_id = any (teacher_ids);
  delete from auth.users where id = p_user_id;
  perform public.write_audit('user.delete', 'profile', p_user_id::text, v_p.department_id,
    'حذف حساب: ' || v_p.full_name || ' (' || v_p.username || ')', null);
end $$;

create or replace function public.change_my_password(p_current text, p_new text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'غير مسجل الدخول' using errcode = '42501'; end if;
  if length(coalesce(p_new, '')) < 6 then
    raise exception 'كلمة المرور الجديدة يجب أن لا تقل عن 6 أحرف' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = auth.uid()
                 and encrypted_password = extensions.crypt(p_current, encrypted_password)) then
    raise exception 'كلمة المرور الحالية غير صحيحة' using errcode = '28P01';
  end if;
  update auth.users set encrypted_password = extensions.crypt(p_new, extensions.gen_salt('bf', 10)), updated_at = now()
  where id = auth.uid();
  update public.profiles set must_change_password = false where id = auth.uid();
  perform public.write_audit('user.change_password', 'profile', auth.uid()::text, public.my_department(),
    'تغيير كلمة المرور الشخصية', null);
end $$;

-- إنشاء أول حساب مدير نظام (يُشغَّل مرة واحدة من SQL Editor)
create or replace function public.create_first_admin(p_username text, p_password text, p_full_name text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid;
begin
  if exists (select 1 from public.profiles where role = 'admin') then
    raise exception 'يوجد حساب مدير نظام مسبقاً';
  end if;
  v_uid := public._create_user(p_username, p_password, p_full_name, 'admin', null, null);
  update public.profiles set must_change_password = false where id = v_uid;
  return v_uid;
end $$;

-- ---------------------------------------------------------------------
-- 8) عرض متابعة الإنجاز
-- ---------------------------------------------------------------------

create or replace view public.subject_progress with (security_invoker = true) as
select s.id as subject_id, s.year_id, s.department_id, s.stage, s.shift, s.term, s.status,
       coalesce(c.n_students, 0)::int as n_students,
       coalesce(c.n_complete, 0)::int as n_complete,
       coalesce(c.n_pass, 0)::int as n_pass,
       coalesce(c.n_fail, 0)::int as n_fail,
       coalesce(c.n_special, 0)::int as n_special,
       c.avg_total,
       s.r2_status,
       coalesce(c.n_r2_needed, 0)::int as n_r2_needed,
       coalesce(c.n_r2_done, 0)::int as n_r2_done
from public.subjects s
left join lateral (
  select count(*) as n_students,
         count(*) filter (where g.special is not null or public.grade_total(s, g) is not null) as n_complete,
         count(*) filter (where public.grade_passed(s, g)) as n_pass,
         count(*) filter (where not public.grade_passed(s, g)) as n_fail,
         count(*) filter (where g.special is not null) as n_special,
         round(avg(public.grade_total(s, g)), 2) as avg_total,
         count(*) filter (where g.special is not null or not public.grade_passed(s, g)) as n_r2_needed,
         count(*) filter (where (g.special is not null or not public.grade_passed(s, g))
                            and (g.r2_special is not null or public.grade_r2_total(s, g) is not null)) as n_r2_done
  from public.students st
  left join public.grades g on g.subject_id = s.id and g.student_id = st.id
  where st.year_id = s.year_id and st.department_id = s.department_id
    and st.stage = s.stage and st.shift = s.shift and st.status = 'active'
) c on true;

-- ---------------------------------------------------------------------
-- 9) سياسات أمان الصفوف (RLS)
-- ---------------------------------------------------------------------

alter table public.departments    enable row level security;
alter table public.academic_years enable row level security;
alter table public.profiles       enable row level security;
alter table public.settings       enable row level security;
alter table public.students       enable row level security;
alter table public.subjects       enable row level security;
alter table public.grades         enable row level security;
alter table public.audit_log      enable row level security;
alter table public.curriculum     enable row level security;
alter table public.announcements  enable row level security;

drop policy if exists departments_read on public.departments;
create policy departments_read on public.departments for select to authenticated using (true);
drop policy if exists departments_write on public.departments;
create policy departments_write on public.departments for all to authenticated
  using (public.is_super()) with check (public.is_super());

drop policy if exists years_read on public.academic_years;
create policy years_read on public.academic_years for select to authenticated using (true);
drop policy if exists years_write on public.academic_years;
create policy years_write on public.academic_years for all to authenticated
  using (public.is_super()) with check (public.is_super());

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (true);

drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select to authenticated using (true);
drop policy if exists settings_write on public.settings;
create policy settings_write on public.settings for update to authenticated
  using (public.my_role() in ('admin','dean')) with check (public.my_role() in ('admin','dean'));

drop policy if exists students_read on public.students;
create policy students_read on public.students for select to authenticated using (
  public.can_view_all()
  or (public.my_role() = 'head' and department_id = public.my_department())
  or public.is_class_teacher(year_id, department_id, stage, shift)
);
drop policy if exists students_insert on public.students;
create policy students_insert on public.students for insert to authenticated
  with check (public.can_manage_department(department_id));
drop policy if exists students_update on public.students;
create policy students_update on public.students for update to authenticated
  using (public.can_manage_department(department_id)) with check (public.can_manage_department(department_id));
drop policy if exists students_delete on public.students;
create policy students_delete on public.students for delete to authenticated
  using (public.can_manage_department(department_id));

drop policy if exists subjects_read on public.subjects;
create policy subjects_read on public.subjects for select to authenticated using (
  public.can_view_all()
  or (public.my_role() = 'head' and department_id = public.my_department())
  or auth.uid() = any (teacher_ids)
);
drop policy if exists subjects_insert on public.subjects;
create policy subjects_insert on public.subjects for insert to authenticated
  with check (public.can_manage_department(department_id));
drop policy if exists subjects_update on public.subjects;
create policy subjects_update on public.subjects for update to authenticated
  using (public.can_manage_department(department_id)) with check (public.can_manage_department(department_id));
drop policy if exists subjects_delete on public.subjects;
create policy subjects_delete on public.subjects for delete to authenticated
  using (public.can_manage_department(department_id));

drop policy if exists grades_read on public.grades;
create policy grades_read on public.grades for select to authenticated
  using (exists (select 1 from public.subjects s where s.id = subject_id)
         and not public.grades_hidden_for_me(subject_id));
drop policy if exists grades_insert on public.grades;
create policy grades_insert on public.grades for insert to authenticated
  with check (public.can_write_subject(subject_id));
drop policy if exists grades_update on public.grades;
create policy grades_update on public.grades for update to authenticated
  using (public.can_write_subject(subject_id)) with check (public.can_write_subject(subject_id));
drop policy if exists grades_delete on public.grades;
create policy grades_delete on public.grades for delete to authenticated
  using (public.can_write_subject(subject_id));

drop policy if exists announcements_read on public.announcements;
create policy announcements_read on public.announcements for select to authenticated
  using (public.can_read_announcement(announcements));
drop policy if exists announcements_insert on public.announcements;
create policy announcements_insert on public.announcements for insert to authenticated
  with check (public.is_super() or (public.my_role() = 'head' and department_id = public.my_department()));
drop policy if exists announcements_update on public.announcements;
create policy announcements_update on public.announcements for update to authenticated
  using (public.is_super() or (public.my_role() = 'head' and created_by = auth.uid()))
  with check (public.is_super() or (public.my_role() = 'head' and department_id = public.my_department()));
drop policy if exists announcements_delete on public.announcements;
create policy announcements_delete on public.announcements for delete to authenticated
  using (public.is_super() or (public.my_role() = 'head' and created_by = auth.uid()));

drop policy if exists curriculum_read on public.curriculum;
create policy curriculum_read on public.curriculum for select to authenticated using (true);
drop policy if exists curriculum_write on public.curriculum;
create policy curriculum_write on public.curriculum for all to authenticated
  using (public.can_manage_department(department_id)) with check (public.can_manage_department(department_id));

drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using (
  public.can_view_all() or (public.my_role() = 'head' and department_id = public.my_department())
);

-- ---------------------------------------------------------------------
-- 10) الصلاحيات على مستوى قاعدة البيانات
-- ---------------------------------------------------------------------

revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.departments, public.academic_years, public.students,
  public.subjects, public.grades, public.curriculum, public.announcements to authenticated;
grant select, update on public.settings to authenticated;
grant select on public.profiles, public.audit_log, public.subject_progress to authenticated;
revoke insert, update, delete on public.profiles, public.audit_log from authenticated;

revoke execute on all functions in schema public from public, anon;
revoke execute on function public._create_user(text, text, text, text, uuid, text) from authenticated;
revoke execute on function public.create_first_admin(text, text, text) from authenticated;
revoke execute on function public.write_audit(text, text, text, uuid, text, jsonb) from authenticated;
grant execute on function
  public.my_role(), public.my_department(), public.is_super(), public.can_view_all(),
  public.can_manage_department(uuid), public.is_class_teacher(uuid, uuid, smallint, text),
  public.can_write_subject(uuid), public.grade_edit_block_reason(uuid), public.grade_r2_block_reason(uuid),
  public.apply_rounding(numeric), public.grade_total(public.subjects, public.grades),
  public.grade_r2_total(public.subjects, public.grades),
  public.grade_passed(public.subjects, public.grades),
  public.grades_hidden_for_me(uuid), public.can_read_announcement(public.announcements),
  public.log_client_event(text, text, jsonb),
  public.save_grades(uuid, jsonb, text),
  public.add_students(uuid, uuid, smallint, text, text[]),
  public.reorder_students(uuid[]),
  public.set_subject_status(uuid, text, text, smallint),
  public.set_entry_open(boolean, uuid),
  public.copy_subjects(uuid, uuid, smallint, text, smallint, uuid, uuid, smallint, text, smallint, boolean),
  public.can_manage_role(text, uuid), public.can_manage_user(uuid),
  public.create_account(text, text, text, text, uuid, text),
  public.update_account(uuid, text, text, text, uuid, boolean),
  public.reset_password(uuid, text),
  public.delete_account(uuid),
  public.change_my_password(text, text)
to authenticated;

-- ---------------------------------------------------------------------
-- 11) البيانات الأولية
-- ---------------------------------------------------------------------

insert into public.departments (name, code, has_evening, sort) values
  ('تقنيات التخدير',          'ANS', true,  1),
  ('تقنيات الأشعة والسونار',  'RAD', true,  2),
  ('تقنيات صناعة الأسنان',    'DEN', false, 3),
  ('تقنيات صحة المجتمع',      'CHT', true,  4),
  ('تقنيات التجميل والليزر',  'COS', false, 5)
on conflict (name) do nothing;

insert into public.academic_years (label) values ('2025-2026'), ('2026-2027')
on conflict (label) do nothing;

-- <plans> (مولَّد تلقائياً من scripts/plans_data.py — لا تعدّله يدوياً)
-- الخطط الدراسية الرسمية 2025-2026: التخدير، الأشعة والسونار، صناعة الأسنان، صحة المجتمع (المراحل الأربع)
insert into public.curriculum (department_id, stage, term, sort, name, name_en, category, language, theory_hours, practical_hours, units)
select d.id, v.stage, v.term, v.sort, v.name, v.name_en, v.category, v.language, v.th, v.pr, v.units
from public.departments d
cross join (values
  (1, 1, 1, 'الفيزياء الطبية 1', 'Medical Physics (1)', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (1, 1, 2, 'التشريح 1', 'Anatomy (1)', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (1, 1, 3, 'الفسلجة العامة 1', 'General Physiology (1)', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (1, 1, 4, 'الكيمياء العامة', 'General Chemistry', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (1, 1, 5, 'البايولوجي', 'Biology', 'مساعدة', 'English', 2, 4, 4),
  (1, 1, 6, 'مبادئ الحاسوب', 'Computer Fundamentals', 'عامة', 'English', 1, 2, 2),
  (1, 1, 7, 'حقوق الانسان والديمقراطية', 'Human Rights and Democracy', 'عامة', 'العربية', 2, 0, 2),
  (1, 1, 8, 'المصطلحات الطبية 1', 'Medical Terminology (1)', 'عامة', 'English', 1, 0, 1),
  (1, 1, 9, 'اللغة العربية 1', 'Arabic Language (1)', 'عامة', 'العربية', 1, 0, 1),
  (1, 2, 1, 'الفيزياء الطبية 2', 'Medical Physics (2)', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (1, 2, 2, 'التشريح 2', 'Anatomy (2)', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (1, 2, 3, 'الفسلجة العامة 2', 'General Physiology (2)', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (1, 2, 4, 'الكيمياء الحيوية', 'Biochemistry', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (1, 2, 5, 'المايكروبايولوجي', 'Microbiology', 'مساعدة', 'English', 2, 4, 4),
  (1, 2, 6, 'المصطلحات الطبية 2', 'Medical Terminology (2)', 'عامة', 'English', 1, 0, 1),
  (1, 2, 7, 'اللغة العربية 2', 'Arabic Language (2)', 'عامة', 'العربية', 1, 0, 1),
  (2, 1, 1, 'اسس التخدير 1', 'Basics of Anesthesia (1)', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (2, 1, 2, 'اسس اجهزة التخدير 1', 'Basics of Anesthetic Equipment (1)', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (2, 1, 3, 'الفسلجة التطبيقية 1', 'Applied Physiology (1)', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (2, 1, 4, 'اسس الجراحة 1', 'Basics of Surgery (1)', 'تخصصية / اساسية', 'English', 1, 4, 3),
  (2, 1, 5, 'اسس الطب الباطني 1', 'Basics of Medicine (1)', 'مساعدة', 'English', 2, 4, 4),
  (2, 1, 6, 'الدوائيات 1', 'Pharmacology (1)', 'مساعدة', 'English', 2, 2, 3),
  (2, 1, 7, 'المصطلحات الطبية', 'Medical Terminology', 'عامة', 'English', 2, 0, 2),
  (2, 1, 8, 'تطبيقات الحاسوب', 'Computer Applications', 'عامة', 'English', 1, 2, 2),
  (2, 1, 9, 'جرائم نظام البعث في العراق', 'Crimes of the Baath Regime in Iraq', 'مساعدة', 'العربية', 2, 0, 2),
  (2, 1, 10, 'اللغة العربية 1', 'Arabic Language (1)', 'عامة', 'العربية', 1, 0, 1),
  (2, 2, 1, 'اسس التخدير 2', 'Basics of Anesthesia (2)', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (2, 2, 2, 'اسس اجهزة التخدير 2', 'Basics of Anesthetic Equipment (2)', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (2, 2, 3, 'الفسلجة التطبيقية 2', 'Applied Physiology (2)', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (2, 2, 4, 'اسس الجراحة 2', 'Basics of Surgery (2)', 'تخصصية / اساسية', 'English', 1, 4, 3),
  (2, 2, 5, 'اسس الطب الباطني 2', 'Basics of Medicine (2)', 'مساعدة', 'English', 2, 4, 4),
  (2, 2, 6, 'الدوائيات 2', 'Pharmacology (2)', 'مساعدة', 'English', 2, 2, 3),
  (2, 2, 7, 'الاحصاء', 'Statistics', 'مساعدة', 'English', 1, 2, 2),
  (2, 2, 8, 'اللغة العربية 2', 'Arabic Language (2)', 'عامة', 'العربية', 1, 0, 1),
  (3, 1, 1, 'التخدير 1', 'Anesthesia (1)', 'تخصصية / اساسية', 'English', 2, 5, 4),
  (3, 1, 2, 'اسس العناية المركزة 1', 'Basics of Intensive Care (1)', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (3, 1, 3, 'تقنيات أجهزة التخدير 1', 'Anaesthetic Equipment Technology (1)', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (3, 1, 4, 'الطب الباطني 1', 'Medicine (1)', 'مساعدة', 'English', 2, 4, 4),
  (3, 1, 5, 'الجراحة 1', 'Surgery (1)', 'تخصصية / اساسية', 'English', 1, 3, 2),
  (3, 2, 1, 'التخدير 2', 'Anesthesia (2)', 'تخصصية / اساسية', 'English', 2, 5, 4),
  (3, 2, 2, 'اسس العناية المركزة 2', 'Basics of Intensive Care (2)', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (3, 2, 3, 'تقنيات أجهزة التخدير 2', 'Anaesthetic Equipment Technology (2)', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (3, 2, 4, 'الطب الباطني 2', 'Medicine (2)', 'مساعدة', 'English', 2, 4, 4),
  (3, 2, 5, 'الجراحة 2', 'Surgery (2)', 'تخصصية / اساسية', 'English', 1, 3, 2),
  (4, 1, 1, 'تخدير متقدم 1', 'Advanced Anesthesia (1)', 'تخصصية / اساسية', 'English', 2, 5, 4),
  (4, 1, 2, 'تقنية اجهزة التخدير المتقدم 1', 'Advanced Anaesthetic Equipment Technology (1)', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (4, 1, 3, 'تقنيات العناية المركزة 1', 'Intensive Care Technology (1)', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (4, 1, 4, 'الطب الباطني المتقدم 1', 'Advanced Medicine (1)', 'تخصصية / اساسية', 'English', 2, 3, 3),
  (4, 1, 5, 'طب الالم', 'Pain Medicine', 'مساعدة', 'English', 2, 3, 3),
  (4, 1, 6, 'اخلاقيات المهنة', 'Professional Ethics', 'مساعدة', 'العربية', 2, 0, 2),
  (4, 2, 1, 'تخدير متقدم 2', 'Advanced Anesthesia (2)', 'تخصصية / اساسية', 'English', 2, 5, 4),
  (4, 2, 2, 'تقنية اجهزة التخدير المتقدم 2', 'Advanced Anaesthetic Equipment Technology (2)', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (4, 2, 3, 'تقنيات العناية المركزة 2', 'Intensive Care Technology (2)', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (4, 2, 4, 'الطب الباطني المتقدم 2', 'Advanced Medicine (2)', 'تخصصية / اساسية', 'English', 2, 3, 3),
  (4, 2, 5, 'طب الطوارئ', 'Emergency Medicine', 'مساعدة', 'English', 2, 3, 3),
  (4, 2, 6, 'مشروع التخرج', 'Graduation Project', 'مساعدة', 'English', 0, 6, 4)
) as v(stage, term, sort, name, name_en, category, language, th, pr, units)
where d.code = 'ANS'
on conflict (department_id, stage, term, name) do nothing;

insert into public.curriculum (department_id, stage, term, sort, name, name_en, category, language, theory_hours, practical_hours, units)
select d.id, v.stage, v.term, v.sort, v.name, v.name_en, v.category, v.language, v.th, v.pr, v.units
from public.departments d
cross join (values
  (1, 1, 1, 'تشريح الهيكل العظمي', 'Anatomy of Skeleton', 'تخصصية', 'English', 2, 3, 3),
  (1, 1, 2, 'الفيزياء العامة', 'General Physics', 'مساعدة', 'English', 2, 3, 3),
  (1, 1, 3, 'علم الفسلجة العام', 'General Physiology', 'مساعدة', 'English', 2, 3, 3),
  (1, 1, 4, 'البايولوجي', 'Biology', 'مساعدة', 'English', 2, 3, 3),
  (1, 1, 5, 'الكيمياء العامة', 'General Chemistry', 'مساعدة', 'English', 2, 3, 3),
  (1, 1, 6, 'مبادئ الحاسوب', 'Computer Fundamentals', 'عامة', 'English', 1, 2, 2),
  (1, 1, 7, 'حقوق الانسان والديمقراطية', 'Human Rights and Democracy', 'عامة', 'العربية', 2, 0, 2),
  (1, 1, 8, 'المصطلحات الطبية 1', 'Medical Terminology (1)', 'عامة', 'English', 1, 0, 1),
  (1, 1, 9, 'اللغة العربية 1', 'Arabic Language (1)', 'عامة', 'العربية', 1, 0, 1),
  (1, 2, 1, 'تشريح اجهزة الجسم', 'Anatomy of Body Systems', 'تخصصية', 'English', 2, 3, 3),
  (1, 2, 2, 'فيزياء الذرة', 'Physics of Atom', 'مساعدة', 'English', 2, 3, 3),
  (1, 2, 3, 'علم الفسلجة الوظيفي', 'Systemic Physiology', 'مساعدة', 'English', 2, 3, 3),
  (1, 2, 4, 'البايولوجي الاشعاعي', 'Radiobiology', 'مساعدة', 'English', 2, 4, 4),
  (1, 2, 5, 'اسس التمريض', 'Principles of Nursing', 'مساعدة', 'English', 2, 4, 4),
  (1, 2, 6, 'المصطلحات الطبية 2', 'Medical Terminology (2)', 'عامة', 'English', 1, 0, 1),
  (1, 2, 7, 'اللغة العربية 2', 'Arabic Language (2)', 'عامة', 'العربية', 1, 0, 1),
  (2, 1, 1, 'تقنيات الاجهزة الشعاعية التقليدية', 'Conventional Radiological Equipment Techniques', 'تخصصية', 'English', 2, 5, 4),
  (2, 1, 2, 'تقنيات التصوير الشعاعي للاطراف العليا', 'Radiographic Techniques for Upper Limbs', 'تخصصية', 'English', 2, 5, 4),
  (2, 1, 3, 'فحوصات شعاعية خاصة للجهاز الهضمي والعظام', 'Special Radiological Procedures of GIT and Bones', 'تخصصية', 'English', 2, 5, 4),
  (2, 1, 4, 'التشريح الشعاعي للرأس والاطراف العليا', 'Radiological Anatomy of Head and Upper Limbs', 'تخصصية', 'English', 2, 4, 4),
  (2, 1, 5, 'اساسيات الفيزياء الشعاعية', 'Fundamentals of Radio-physics', 'مساعدة', 'English', 2, 3, 3),
  (2, 1, 6, 'اساسيات الوقاية من الاشعاع', 'Fundamentals of Radiation Protection', 'مساعدة', 'English', 2, 3, 3),
  (2, 1, 7, 'تطبيقات الحاسوب', 'Computer Applications', 'عامة', 'English', 1, 2, 2),
  (2, 1, 8, 'جرائم نظام البعث في العراق', 'Crimes of the Baath Regime in Iraq', 'عامة', 'العربية', 2, 0, 2),
  (2, 1, 9, 'اللغة العربية 1', 'Arabic Language (1)', 'عامة', 'العربية', 1, 0, 1),
  (2, 2, 1, 'تقنيات أجهزة التصوير المقطعي المحوسب', 'Computed Tomography Equipment Techniques', 'تخصصية', 'English', 2, 5, 4),
  (2, 2, 2, 'تقنيات التصوير الشعاعي للاطراف السفلى', 'Radiographic Techniques for Lower Limbs', 'تخصصية', 'English', 2, 5, 4),
  (2, 2, 3, 'فحوصات شعاعية خاصة للجهاز الصفراوي والتناسلي', 'Special Radiological Procedures of Biliary and Reproductive System', 'تخصصية', 'English', 2, 5, 4),
  (2, 2, 4, 'التشريح الشعاعي للاطراف السفلى', 'Radiological Anatomy of Lower Limbs', 'تخصصية', 'English', 2, 4, 4),
  (2, 2, 5, 'فيزياء التصوير المقطعي المحوسب', 'Physics of Computed Tomography', 'مساعدة', 'English', 2, 3, 3),
  (2, 2, 6, 'اللغة العربية 2', 'Arabic Language (2)', 'عامة', 'العربية', 1, 0, 1),
  (3, 1, 1, 'تقنيات أجهزة الرنين المغناطيسي', 'MRI Equipment Techniques', 'تخصصية', 'English', 2, 4, 4),
  (3, 1, 2, 'تقنيات التصوير الشعاعي للرأس والعمود الفقري', 'Radiographic Techniques for Head and Spinal Cord', 'تخصصية', 'English', 2, 4, 4),
  (3, 1, 3, 'فحوصات شعاعية خاصة للرأس والثدي والجهاز التنفسي', 'Special Radiological Procedures of Head, Breast and Respiratory System', 'تخصصية', 'English', 2, 4, 4),
  (3, 1, 4, 'التشريح الشعاعي للدماغ والعمود الفقري', 'Radiological Anatomy of Brain and Spinal Column', 'تخصصية', 'English', 2, 2, 3),
  (3, 1, 5, 'علم الأمراض العام', 'General Pathology', 'مساعدة', 'English', 2, 2, 3),
  (3, 1, 6, 'فيزياء الرنين المغناطيسي', 'Physics of Magnetic Resonance', 'مساعدة', 'English', 1, 3, 2),
  (3, 1, 7, 'مخاطر الإشعاع البايولوجية', 'Biological Radiation Hazards', 'مساعدة', 'English', 2, 3, 3),
  (3, 2, 1, 'تقنيات أجهزة السونار', 'Ultrasound Equipment Techniques', 'تخصصية', 'English', 2, 4, 4),
  (3, 2, 2, 'تقنيات التصوير الشعاعي للصدر والبطن', 'Radiographic Techniques of Thorax and Abdomen', 'تخصصية', 'English', 2, 4, 4),
  (3, 2, 3, 'فحوصات شعاعية خاصة لجهاز القلب والأوعية الدموية والجهاز العصبي', 'Special Radiological Procedures of Cardiovascular and Central Nervous System', 'تخصصية', 'English', 2, 4, 4),
  (3, 2, 4, 'التشريح الشعاعي للصدر والبطن', 'Radiological Anatomy of Thorax and Abdomen', 'تخصصية', 'English', 2, 2, 3),
  (3, 2, 5, 'علم الأمراض الوظيفي', 'Systemic Pathology', 'مساعدة', 'English', 2, 2, 3),
  (3, 2, 6, 'فيزياء الامواج فوق الصوتية', 'Physics of Ultrasound', 'مساعدة', 'English', 1, 3, 2),
  (4, 1, 1, 'التصوير المقطعي المحوسب للرأس والعمود الفقري', 'CT Imaging of Head and Spinal Cord', 'تخصصية', 'English', 2, 5, 4),
  (4, 1, 2, 'مبادئ التصوير بالرنين المغناطيسي وفحوصات الرأس', 'MRI Principles and Head Exam', 'تخصصية', 'English', 2, 5, 4),
  (4, 1, 3, 'التصوير بالموجات فوق الصوتية للبطن', 'Abdominal Ultrasound Imaging', 'تخصصية', 'English', 2, 5, 4),
  (4, 1, 4, 'طب الامراض الباطنية', 'Medicine of Internal Diseases', 'مساعدة', 'English', 2, 3, 3),
  (4, 1, 5, 'الاحصاء الحيوي وتطبيقات الحاسوب', 'Biostatistics and Computer Applications', 'مساعدة', 'English', 2, 4, 4),
  (4, 2, 1, 'التصوير المقطعي المحوسب للصدر والبطن والحوض', 'CT Imaging of Chest, Abdomen and Pelvis', 'تخصصية', 'English', 2, 5, 4),
  (4, 2, 2, 'التصوير بالرنين المغناطيسي للجهاز العضلي والعظمي والبطن والحوض', 'MRI of Musculoskeletal System, Abdomen and Pelvis', 'تخصصية', 'English', 2, 5, 4),
  (4, 2, 3, 'التصوير بالموجات فوق الصوتية للأمراض النسائية والتوليد', 'Obstetric and Gynecologic Ultrasound Imaging', 'تخصصية', 'English', 2, 5, 4),
  (4, 2, 4, 'طب الامراض الجراحية', 'Medicine of Surgical Diseases', 'مساعدة', 'English', 2, 3, 3),
  (4, 2, 5, 'اخلاقيات المهنة', 'Professional Ethics', 'عامة', 'العربية', 2, 0, 2),
  (4, 2, 6, 'مشروع التخرج', 'Graduation Project', 'تخصصية', 'English', 0, 6, 4)
) as v(stage, term, sort, name, name_en, category, language, th, pr, units)
where d.code = 'RAD'
on conflict (department_id, stage, term, name) do nothing;

insert into public.curriculum (department_id, stage, term, sort, name, name_en, category, language, theory_hours, practical_hours, units)
select d.id, v.stage, v.term, v.sort, v.name, v.name_en, v.category, v.language, v.th, v.pr, v.units
from public.departments d
cross join (values
  (1, 1, 1, 'المادة السنية (أساسي)', 'Dental Materials (Basic)', 'تخصصية', 'English', 2, 5, 4),
  (1, 1, 2, 'تقنيات أجهزة الأسنان (أساسي)', 'Dental Equipment Technologies (Basic)', 'تخصصية', 'English', 2, 5, 4),
  (1, 1, 3, 'تشريح الأسنان (أساسي)', 'Dental Anatomy (Basic)', 'تخصصية', 'English', 2, 5, 4),
  (1, 1, 4, 'السلامة المهنية', 'Occupational Safety', 'تخصصية', 'English', 2, 0, 2),
  (1, 1, 5, 'المصطلحات الطبية 1', 'Medical Terms (1)', 'عامة', 'English', 1, 0, 1),
  (1, 1, 6, 'حقوق الانسان والديمقراطية', 'Human Rights and Democracy', 'عامة', 'العربية', 2, 0, 2),
  (1, 1, 7, 'اللغة العربية 1', 'Arabic Language (1)', 'عامة', 'العربية', 1, 0, 1),
  (1, 2, 1, 'المادة السنية (متوسط)', 'Dental Materials (Intermediate)', 'تخصصية', 'English', 2, 5, 4),
  (1, 2, 2, 'تقنيات أجهزة الأسنان (متقدم)', 'Dental Equipment Technologies (Advanced)', 'تخصصية', 'English', 2, 5, 4),
  (1, 2, 3, 'تشريح الأسنان (متقدم)', 'Dental Anatomy (Advanced)', 'تخصصية', 'English', 2, 5, 4),
  (1, 2, 4, 'فيزياء عامة', 'General Physics', 'مساعدة', 'English', 2, 4, 4),
  (1, 2, 5, 'اللغة العربية 2', 'Arabic Language (2)', 'عامة', 'العربية', 1, 0, 1),
  (1, 2, 6, 'مبادئ الحاسوب', 'Computer Fundamentals', 'عامة', 'العربية', 1, 2, 2),
  (1, 2, 7, 'المصطلحات الطبية 2', 'Medical Terms (2)', 'عامة', 'English', 1, 0, 1),
  (2, 1, 1, 'المادة السنية (متقدم)', 'Dental Materials (Advanced)', 'تخصصية', 'English', 2, 5, 4),
  (2, 1, 2, 'الطقم الكامل (أساسي)', 'Complete Denture (Basic)', 'تخصصية', 'English', 2, 5, 4),
  (2, 1, 3, 'التيجان (أساسي)', 'Crowns (Basic)', 'تخصصية', 'English', 2, 5, 4),
  (2, 1, 4, 'انسجة الفم', 'Oral Histology', 'مساعدة', 'English', 2, 3, 3),
  (2, 1, 5, 'كيمياء (أساسي)', 'Chemistry (Basic)', 'مساعدة', 'English', 2, 4, 4),
  (2, 1, 6, 'جرائم نظام البعث في العراق', 'Crimes of the Baath Regime in Iraq', 'عامة', 'العربية', 2, 0, 2),
  (2, 1, 7, 'اللغة العربية 1', 'Arabic Language (1)', 'عامة', 'العربية', 1, 0, 1),
  (2, 2, 1, 'الطقم الجزئي المتحرك (أساسي)', 'Removable Partial Denture (Basic)', 'تخصصية', 'English', 2, 5, 4),
  (2, 2, 2, 'التيجان (متقدم)', 'Crowns (Advanced)', 'تخصصية', 'English', 2, 5, 4),
  (2, 2, 3, 'فسلجة الفم', 'Oral Physiology', 'مساعدة', 'English', 2, 4, 4),
  (2, 2, 4, 'تشريح الرأس والرقبة', 'Anatomy of Head and Neck', 'مساعدة', 'English', 2, 4, 4),
  (2, 2, 5, 'كيمياء (متقدم)', 'Chemistry (Advanced)', 'مساعدة', 'English', 2, 4, 4),
  (2, 2, 6, 'اللغة العربية 2', 'Arabic Language (2)', 'عامة', 'العربية', 1, 0, 1),
  (2, 2, 7, 'تطبيقات الحاسوب', 'Computer Applications', 'عامة', 'العربية', 1, 2, 2),
  (3, 1, 1, 'الطقم الجزئي المتحرك (متوسط)', 'Removable Partial Denture (Intermediate)', 'تخصصية', 'English', 2, 4, 4),
  (3, 1, 2, 'الطقم الكامل (متوسط)', 'Complete Denture (Intermediate)', 'تخصصية', 'English', 2, 4, 4),
  (3, 1, 3, 'الجسور (أساسي)', 'Bridge (Basic)', 'تخصصية', 'English', 2, 4, 4),
  (3, 1, 4, 'تقويم الأسنان (أساسي)', 'Orthodontic (Basic)', 'تخصصية', 'English', 2, 4, 4),
  (3, 1, 5, 'امراض الفم', 'Oral Pathology', 'مساعدة', 'English', 1, 2, 2),
  (3, 2, 1, 'الجسور (متقدم)', 'Bridge (Advanced)', 'تخصصية', 'English', 2, 5, 4),
  (3, 2, 2, 'تعويضات الوجه والفكين (أساسي)', 'Maxillofacial Prosthesis (Basic)', 'تخصصية', 'English', 2, 5, 4),
  (3, 2, 3, 'تقويم الأسنان (متوسط)', 'Orthodontic (Intermediate)', 'تخصصية', 'English', 2, 5, 4),
  (3, 2, 4, 'بكتيريا الفم', 'Oral Bacteriology', 'مساعدة', 'English', 2, 3, 3),
  (3, 2, 5, 'طرائق البحث', 'Research Methods', 'عامة', 'English', 1, 0, 1),
  (4, 1, 1, 'الطقم الجزئي المتحرك (متقدم 1)', 'Removable Partial Denture (Advanced 1)', 'تخصصية', 'English', 2, 4, 4),
  (4, 1, 2, 'الطقم الكامل (متقدم 1)', 'Complete Denture (Advanced 1)', 'تخصصية', 'English', 2, 4, 4),
  (4, 1, 3, 'التيجان والجسور (أساسي)', 'Crown and Bridge (Basic)', 'تخصصية', 'English', 2, 4, 4),
  (4, 1, 4, 'تقويم الأسنان (متقدم 1)', 'Orthodontic (Advanced 1)', 'تخصصية', 'English', 2, 4, 4),
  (4, 1, 5, 'تعويضات الوجه والفكين (متوسط)', 'Maxillofacial Prosthesis (Intermediate)', 'تخصصية', 'English', 2, 4, 4),
  (4, 1, 6, 'زراعة الأسنان', 'Dental Implant', 'تخصصية', 'English', 2, 4, 4),
  (4, 2, 1, 'الطقم الجزئي المتحرك (متقدم 2)', 'Removable Partial Denture (Advanced 2)', 'تخصصية', 'English', 2, 4, 4),
  (4, 2, 2, 'الطقم الكامل (متقدم 2)', 'Complete Denture (Advanced 2)', 'تخصصية', 'English', 2, 4, 4),
  (4, 2, 3, 'التيجان والجسور (متقدم)', 'Crown and Bridge (Advanced)', 'تخصصية', 'English', 2, 4, 4),
  (4, 2, 4, 'تقويم الأسنان (متقدم 2)', 'Orthodontic (Advanced 2)', 'تخصصية', 'English', 2, 4, 4),
  (4, 2, 5, 'تعويضات الوجه والفكين (متقدم)', 'Maxillofacial Prosthesis (Advanced)', 'تخصصية', 'English', 2, 4, 4),
  (4, 2, 6, 'اخلاقيات المهنة', 'Professional Ethics', 'عامة', 'العربية', 2, 0, 2),
  (4, 2, 7, 'مشروع التخرج', 'Graduation Project', 'تخصصية', 'English', 0, 6, 4)
) as v(stage, term, sort, name, name_en, category, language, th, pr, units)
where d.code = 'DEN'
on conflict (department_id, stage, term, name) do nothing;

insert into public.curriculum (department_id, stage, term, sort, name, name_en, category, language, theory_hours, practical_hours, units)
select d.id, v.stage, v.term, v.sort, v.name, v.name_en, v.category, v.language, v.th, v.pr, v.units
from public.departments d
cross join (values
  (1, 1, 1, 'تقنيات الأجهزة الطبية', 'Techniques for Medical Device', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (1, 1, 2, 'علم الاحياء المجهرية الطبية 1', 'Medical Microbiology 1', 'تخصصية / مساعدة', 'English', 2, 4, 4),
  (1, 1, 3, 'مبادئ صحة المجتمع 1', 'Principles of Community Health 1', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (1, 1, 4, 'الكيمياء السريرية 1', 'Clinical Chemistry 1', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (1, 1, 5, 'التشريح العام 1', 'General Anatomy 1', 'تخصصية / مساعدة', 'English', 2, 4, 4),
  (1, 1, 6, 'علم وظائف الاعضاء 1', 'Physiology 1', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (1, 1, 7, 'مصطلحات طبية', 'Medical Terminology (1)', 'عامة', 'English', 1, 0, 1),
  (1, 1, 8, 'حقوق الانسان والديمقراطية', 'Human Rights and Democracy', 'عامة', 'العربية', 2, 0, 2),
  (1, 1, 9, 'اللغة العربية', 'Arabic Language (1)', 'عامة', 'العربية', 1, 0, 1),
  (1, 2, 1, 'علم الاحياء المجهرية الطبية 2', 'Medical Microbiology 2', 'تخصصية / مساعدة', 'English', 2, 4, 4),
  (1, 2, 2, 'مبادئ صحة المجتمع 2', 'Principles of Community Health 2', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (1, 2, 3, 'الكيمياء السريرية 2', 'Clinical Chemistry 2', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (1, 2, 4, 'التشريح العام 2', 'General Anatomy 2', 'تخصصية / مساعدة', 'English', 2, 4, 4),
  (1, 2, 5, 'علم وظائف الاعضاء 2', 'Physiology 2', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (1, 2, 6, 'اللغة العربية', 'Arabic Language', 'عامة', 'العربية', 1, 0, 1),
  (1, 2, 7, 'مبادئ الحاسوب', 'Computer Fundamentals', 'عامة', 'العربية', 1, 2, 2),
  (1, 2, 8, 'مصطلحات طبية 2', 'Medical Terminology (2)', 'عامة', 'English', 1, 0, 1),
  (2, 1, 1, 'علم التغذية 1', 'Nutrition 1', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (2, 1, 2, 'امراض انتقالية 1', 'Communicable Diseases 1', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (2, 1, 3, 'علم الدوائيات 1', 'Pharmacology 1', 'تخصصية / مساعدة', 'English', 2, 2, 3),
  (2, 1, 4, 'علم الوبائيات 1', 'Epidemiology 1', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (2, 1, 5, 'صحة بيئة 1', 'Environmental Health 1', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (2, 1, 6, 'تطبيقات الحاسوب', 'Computer Applications', 'عامة', 'العربية', 1, 2, 2),
  (2, 1, 7, 'جرائم نظام البعث في العراق', 'Crimes of the Baath Regime in Iraq', 'عامة', 'العربية', 2, 0, 2),
  (2, 1, 8, 'اللغة العربية 1', 'Arabic Language (1)', 'عامة', 'العربية', 1, 0, 1),
  (2, 2, 1, 'علم التغذية 2', 'Nutrition 2', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (2, 2, 2, 'امراض انتقالية 2', 'Communicable Diseases 2', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (2, 2, 3, 'علم الدوائيات 2', 'Pharmacology 2', 'تخصصية / مساعدة', 'English', 2, 2, 3),
  (2, 2, 4, 'علم الوبائيات 2', 'Epidemiology 2', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (2, 2, 5, 'إحصاء طبي حياتي', 'Biostatistics', 'تخصصية / اساسية', 'English', 2, 2, 3),
  (2, 2, 6, 'صحة بيئة 2', 'Environmental Health 2', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (2, 2, 7, 'اللغة العربية', 'Arabic Language', 'عامة', 'العربية', 1, 0, 1),
  (3, 1, 1, 'القوانين والرقابة الصحية', 'Health Laws and Supervision', 'تخصصية / اساسية', 'العربية', 2, 4, 4),
  (3, 1, 2, 'التلوث البيئي', 'Environmental Pollution', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (3, 1, 3, 'علم الحشرات الطبية', 'Medical Entomology', 'تخصصية / مساعدة', 'English', 2, 4, 4),
  (3, 1, 4, 'الاحصاء الحياتي المتقدم 1', 'Advanced Vital Statistics 1', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (3, 1, 5, 'امراض مزمنة 1', 'Chronic Diseases 1', 'تخصصية / مساعدة', 'English', 2, 4, 4),
  (3, 2, 1, 'علم السموم', 'Toxicology', 'تخصصية / اساسية', 'English', 2, 2, 3),
  (3, 2, 2, 'طرق بحث', 'Methodology', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (3, 2, 3, 'مسح صحي', 'Health Survey', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (3, 2, 4, 'الإدارة الصحية', 'Health Management', 'تخصصية / مساعدة', 'English', 2, 0, 2),
  (3, 2, 5, 'الاحصاء الحياتي المتقدم 2', 'Advanced Vital Statistics 2', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (3, 2, 6, 'امراض مزمنة 2', 'Chronic Diseases 2', 'تخصصية / مساعدة', 'English', 2, 4, 4),
  (4, 1, 1, 'خدمات صحة المجتمع 1', 'Community Health Services 1', 'تخصصية / اساسية', 'English', 2, 5, 4),
  (4, 1, 2, 'الصحة والسلامة المهنية 1', 'Occupational Health 1', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (4, 1, 3, 'علم الوبائيات السريرية 1', 'Clinical Epidemiology 1', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (4, 1, 4, 'التثقيف الصحي', 'Health Education', 'تخصصية / اساسية', 'English', 2, 5, 4),
  (4, 1, 5, 'الامراض غير الانتقالية 1', 'Non Communicable Diseases 1', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (4, 1, 6, 'الصحة الدولية', 'International Health', 'تخصصية / مساعدة', 'English', 2, 4, 4),
  (4, 2, 1, 'خدمات صحة المجتمع 2', 'Community Health Services 2', 'تخصصية / اساسية', 'English', 2, 5, 4),
  (4, 2, 2, 'الصحة والسلامة المهنية 2', 'Occupational Health 2', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (4, 2, 3, 'السيطرة على الامراض الانتقالية', 'Control of Communicable Diseases', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (4, 2, 4, 'علم الوبائيات السريرية 2', 'Clinical Epidemiology 2', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (4, 2, 5, 'الامراض غير الانتقالية 2', 'Non Communicable Diseases 2', 'تخصصية / اساسية', 'English', 2, 4, 4),
  (4, 2, 6, 'مشروع بحث', 'Research Project', 'تخصصية / مساعدة', 'English', 0, 6, 4),
  (4, 2, 7, 'اخلاقيات المهنة', 'Professional Ethics', 'عامة', 'العربية', 2, 0, 2)
) as v(stage, term, sort, name, name_en, category, language, th, pr, units)
where d.code = 'CHT'
on conflict (department_id, stage, term, name) do nothing;
-- </plans>

insert into public.settings (id, current_year_id)
values (1, (select id from public.academic_years where label = '2026-2027'))
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 12) أول حساب مدير نظام
--     غيّر اسم المستخدم وكلمة المرور ثم أزل علامتي التعليق (--) وشغّل السطر:
-- ---------------------------------------------------------------------
-- select public.create_first_admin('admin', 'ضع-كلمة-مرور-قوية', 'مدير النظام');
