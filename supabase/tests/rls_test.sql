-- اختبارات الصلاحيات وقواعد العمل — تُشغَّل عبر supabase/tests/run.sh
\set ON_ERROR_STOP 1
\pset pager off
\pset tuples_only on
\o /dev/null
set client_min_messages = warning;

create schema t;
grant usage on schema t to authenticated, anon;
create function t.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm not like p_like then
      raise exception 'TEST FAIL: expected error like "%", got: %', p_like, sqlerrm;
    end if;
    return;
  end;
  raise exception 'TEST FAIL: expected error like "%" but succeeded: %', p_like, p_sql;
end $$;
create function t.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is not true then raise exception 'TEST FAIL: %', p_msg; end if;
end $$;
grant execute on all functions in schema t to authenticated, anon;

-- ===== التهيئة =====
select public.create_first_admin('admin', 'secret123', 'مدير النظام') as admin_id \gset
select t.ok((select count(*) = 1 from auth.users where email = 'admin@exam.local'
             and encrypted_password = extensions.crypt('secret123', encrypted_password)), 'admin password hash');
select t.ok((select count(*) = 1 from auth.identities where user_id = :'admin_id'), 'admin identity');
select t.expect_error($$select public.create_first_admin('admin2','secret123','x')$$, '%مسبقاً%');

select id as y from public.academic_years where label = '2026-2027' \gset
select id as rad from public.departments where code = 'RAD' \gset
select id as ans from public.departments where code = 'ANS' \gset

\set as_admin 'reset role; select set_config(''request.jwt.claims'', json_build_object(''sub'', :''admin_id'')::text, false); set role authenticated;'
:as_admin

select t.ok(public.my_role() = 'admin', 'admin role');
select public.create_account('dean', 'secret123', 'العميد', 'dean') as dean_id \gset
select public.create_account('asst', 'secret123', 'معاون العميد', 'assistant_dean') as asst_id \gset
select public.create_account('cmt', 'secret123', 'عضو اللجنة', 'committee') as cmt_id \gset
select public.create_account('radhead', 'secret123', 'مقرر الأشعة', 'head', :'rad') as radhead_id \gset
select public.create_account('anshead', 'secret123', 'مقرر التخدير', 'head', :'ans') as anshead_id \gset
select public.create_account('tch1', 'secret123', 'تدريسي الأشعة', 'teacher', :'rad', 'م.م') as t1_id \gset
select public.create_account('tch2', 'secret123', 'تدريسي التخدير', 'teacher', :'ans') as t2_id \gset
select t.expect_error($$select public.create_account('tch1','secret123','مكرر','teacher')$$, '%مستخدم مسبقاً%');
select t.expect_error($$select public.create_account('ب','secret123','اسم','teacher')$$, '%اسم المستخدم%');
select t.expect_error($$select public.create_account('okname','123','اسم','teacher')$$, '%6 أحرف%');
select t.expect_error($$select public.create_account('nohead','secret123','بدون قسم','head')$$, '%تحديد القسم%');

\set as_dean 'reset role; select set_config(''request.jwt.claims'', json_build_object(''sub'', :''dean_id'')::text, false); set role authenticated;'
\set as_asst 'reset role; select set_config(''request.jwt.claims'', json_build_object(''sub'', :''asst_id'')::text, false); set role authenticated;'
\set as_cmt 'reset role; select set_config(''request.jwt.claims'', json_build_object(''sub'', :''cmt_id'')::text, false); set role authenticated;'
\set as_radhead 'reset role; select set_config(''request.jwt.claims'', json_build_object(''sub'', :''radhead_id'')::text, false); set role authenticated;'
\set as_anshead 'reset role; select set_config(''request.jwt.claims'', json_build_object(''sub'', :''anshead_id'')::text, false); set role authenticated;'
\set as_t1 'reset role; select set_config(''request.jwt.claims'', json_build_object(''sub'', :''t1_id'')::text, false); set role authenticated;'
\set as_t2 'reset role; select set_config(''request.jwt.claims'', json_build_object(''sub'', :''t2_id'')::text, false); set role authenticated;'

-- ===== إنشاء الحسابات حسب الدور =====
:as_dean
select t.expect_error($$select public.create_account('admin3','secret123','مدير آخر','admin')$$, '%صلاحية%');
:as_radhead
select public.create_account('tch3', 'secret123', 'تدريسي جديد', 'teacher', :'ans') as t3_id \gset
select t.ok((select department_id from public.profiles where id = :'t3_id') = :'rad', 'head-created teacher forced into head dept');
select t.expect_error($$select public.create_account('h9','secret123','مقرر','head')$$, '%صلاحية%');
select t.expect_error(format($$select public.reset_password(%L,'newpass1')$$, :'t2_id'), '%صلاحية%');
select public.reset_password(:'t3_id', 'newpass1');
:as_t1
select t.expect_error($$select public.create_account('tch9','secret123','تدريسي','teacher')$$, '%صلاحية%');

-- ===== الطلبة =====
:as_radhead
select t.ok((public.add_students(:'y', :'rad', 2::smallint, 'morning',
  array['احمد كريم  جواد', 'زينب علي حسين', '', 'مريم سعد كاظم', 'احمد كريم جواد']) ->> 'added')::int = 3, 'add 3 students, skip blank+dup');
select t.ok((select array_agg(full_name order by seq) from public.students where department_id = :'rad')
            = array['احمد كريم جواد','زينب علي حسين','مريم سعد كاظم'], 'paste order kept & names normalised');
select t.ok((public.add_students(:'y', :'rad', 2::smallint, 'morning', array['علي كريم جواد']) ->> 'added')::int = 1, 'append');
select t.ok((select max(seq) from public.students where department_id = :'rad') = 4, 'seq continues');
:as_anshead
select t.expect_error(format($$select public.add_students(%L, %L, 2::smallint, 'morning', array['x y z'])$$, :'y', :'rad'), '%صلاحية%');
select t.ok((select count(*) from public.students where department_id = :'rad') = 0, 'ANS head cannot read RAD students');

-- ===== المواد =====
:as_radhead
insert into public.subjects (year_id, department_id, stage, shift, term, name, teacher_ids)
values (:'y', :'rad', 2, 'morning', 2, 'التشريح الشعاعي', array[:'t1_id']::uuid[]) returning id as s1 \gset
insert into public.subjects (year_id, department_id, stage, shift, term, name, coursework_max, cw_practical_max, practical_max)
values (:'y', :'rad', 2, 'morning', 2, 'اللغة العربية', 30, 0, 0) returning id as s2 \gset
select t.ok((select final_max from public.subjects where id = :'s2') = 70, 'theory-only final = 70');
select t.ok((select final_max from public.subjects where id = :'s1') = 35, 'practical subject final = 35');
select t.expect_error(format($$update public.subjects set status = 'approved' where id = %L$$, :'s1'), '%أزرار%');
:as_anshead
select t.expect_error(format($$insert into public.subjects (year_id, department_id, stage, shift, term, name) values (%L,%L,2,'morning',1,'x')$$, :'y', :'rad'), '%row-level security%');

-- ===== رؤية التدريسي =====
:as_t1
select t.ok((select count(*) from public.subjects) = 1, 't1 sees only assigned subject');
select t.ok((select count(*) from public.students) = 4, 't1 sees class students');
:as_t2
select t.ok((select count(*) from public.students) = 0, 't2 sees no RAD students');
select t.ok((select count(*) from public.subjects) = 0, 't2 sees no RAD subjects');

-- ===== إدخال الدرجات =====
:as_t1
select id as st1 from public.students where seq = 1 \gset
select id as st2 from public.students where seq = 2 \gset
select public.save_grades(:'s1', jsonb_build_array(
  jsonb_build_object('student_id', :'st1', 'cw_theory', 20, 'cw_practical', 12, 'final_practical', 20, 'final_theory', 30),
  jsonb_build_object('student_id', :'st2', 'cw_theory', 10, 'cw_practical', 5, 'final_practical', 10, 'final_theory', 20)));
select t.ok((select public.grade_total(s, g) from public.subjects s join public.grades g on g.subject_id = s.id
             where s.id = :'s1' and g.student_id = :'st1') = 82, 'total = 82');
select t.expect_error(format($$select public.save_grades(%L, '[{"student_id":"%s","cw_theory":30}]')$$, :'s1', :'st1'), '%بين 0 و 25%');
select t.expect_error(format($$select public.save_grades(%L, '[{"student_id":"%s","final_theory":36}]')$$, :'s1', :'st1'), '%بين 0 و 35%');
select t.expect_error(format($$select public.save_grades(%L, '[{"student_id":"%s","cw_theory":10}]')$$, :'s2', :'st1'), '%صلاحية%');
select t.expect_error(format($$insert into public.audit_log (action) values ('x')$$), '%permission denied%');
select t.ok((select count(*) from public.audit_log) = 0, 'teacher cannot read audit');

:as_radhead
select public.save_grades(:'s2', jsonb_build_array(
  jsonb_build_object('student_id', :'st1', 'cw_theory', 25, 'final_theory', 60, 'cw_practical', 9, 'final_practical', 9),
  jsonb_build_object('student_id', :'st2', 'special', 'absent', 'cw_theory', 20)));
select t.ok((select cw_practical is null and final_practical is null from public.grades where subject_id = :'s2' and student_id = :'st1'),
            'unused components are nulled');
select t.ok((select n_complete = 2 and n_pass = 1 and n_special = 1 and n_students = 4 from public.subject_progress where subject_id = :'s2'),
            'progress view (theory-only)');
select t.ok((select n_complete = 2 and n_pass = 1 and n_fail = 1 from public.subject_progress where subject_id = :'s1'),
            'progress view (practical)');
select t.ok((select count(*) > 0 from public.audit_log where action = 'grade.create'), 'head sees dept audit');
select t.expect_error(format($$delete from public.subjects where id = %L$$, :'s1'), '%تحتوي على درجات%');
select t.expect_error(format($$delete from public.students where id = %L$$, :'st1'), '%لديه درجات%');
update public.students set status = 'withdrawn' where id = :'st2';
select t.ok((select n_students from public.subject_progress where subject_id = :'s1') = 3, 'withdrawn excluded');
update public.students set status = 'active' where id = :'st2';

-- ===== قفل الإدخال =====
:as_t1
select t.expect_error($$select public.set_entry_open(false)$$, '%الإدارة العليا%');
:as_radhead
select t.expect_error($$select public.set_entry_open(false)$$, '%الإدارة العليا%');
:as_asst
select public.set_entry_open(false);
:as_t1
select t.expect_error(format($$select public.save_grades(%L, '[{"student_id":"%s","cw_theory":21}]')$$, :'s1', :'st1'), '%مغلق%');
:as_radhead
select t.expect_error(format($$select public.save_grades(%L, '[{"student_id":"%s","cw_theory":21}]')$$, :'s1', :'st1'), '%مغلق%');
:as_asst
select public.save_grades(:'s1', format('[{"student_id":"%s","cw_theory":21,"cw_practical":12,"final_practical":20,"final_theory":30}]', :'st1')::jsonb);
select public.set_entry_open(true);
select public.set_entry_open(false, :'rad');
:as_t1
select t.expect_error(format($$select public.save_grades(%L, '[{"student_id":"%s","cw_theory":21}]')$$, :'s1', :'st1'), '%لهذا القسم%');
:as_dean
select public.set_entry_open(true, :'rad');

-- ===== سير العمل: إرسال، إعادة، اعتماد =====
:as_t1
select public.set_subject_status(:'s1', 'submitted');
select t.expect_error(format($$select public.save_grades(%L, '[{"student_id":"%s","cw_theory":21}]')$$, :'s1', :'st1'), '%مرسلة%');
select t.expect_error(format($$select public.set_subject_status(%L, 'approved')$$, :'s1'), '%اللجنة%');
:as_cmt
select t.expect_error(format($$select public.save_grades(%L, '[{"student_id":"%s","cw_theory":21}]')$$, :'s1', :'st1'), '%صلاحية%');
select t.expect_error(format($$select public.set_subject_status(%L, 'returned')$$, :'s1'), '%ملاحظة%');
select public.set_subject_status(:'s1', 'returned', 'يرجى مراجعة درجة الطالب الثاني');
:as_t1
select t.ok((select status = 'returned' and status_note like 'يرجى%' from public.subjects where id = :'s1'), 'returned with note');
select public.save_grades(:'s1', format('[{"student_id":"%s","cw_theory":15,"cw_practical":10,"final_practical":15,"final_theory":20}]', :'st2')::jsonb);
select public.set_subject_status(:'s1', 'submitted');
:as_cmt
select public.set_subject_status(:'s1', 'approved');
select t.expect_error(format($$select public.set_subject_status(%L, 'returned', 'x')$$, :'s1'), '%الإدارة العليا%');
:as_t1
select t.expect_error(format($$select public.save_grades(%L, '[{"student_id":"%s","cw_theory":21}]')$$, :'s1', :'st1'), '%معتمدة%');
:as_dean
select t.expect_error(format($$select public.save_grades(%L, '[{"student_id":"%s","cw_theory":22,"cw_practical":12,"final_practical":20,"final_theory":30}]')$$, :'s1', :'st1'), '%سبب%');
select public.save_grades(:'s1', format('[{"student_id":"%s","cw_theory":22,"cw_practical":12,"final_practical":20,"final_theory":30}]', :'st1')::jsonb, 'تصحيح خطأ في الجمع');
select t.ok((select details ->> 'reason' = 'تصحيح خطأ في الجمع' and (details -> 'old' ->> 'cw_theory')::numeric = 21
             and (details -> 'new' ->> 'cw_theory')::numeric = 22
             from public.audit_log where action = 'grade.update' order by id desc limit 1), 'audit keeps old/new/reason');
select t.ok((select count(*) = 1 from public.audit_log where action = 'subject.approved'), 'approval audited');

-- ===== تعديل توزيع الدرجات =====
:as_radhead
select t.expect_error(format($$update public.subjects set practical_max = 20 where id = %L$$, :'s1'), '%مرسلة أو معتمدة%');
select t.expect_error(format($$update public.subjects set coursework_max = 20, cw_practical_max = 0, practical_max = 0 where id = %L$$, :'s2'), '%لا يتوافق%');
update public.subjects set name = 'اللغة العربية (1)' where id = :'s2';

-- ===== نسخ المواد =====
select t.ok(public.copy_subjects(:'y', :'rad', 2::smallint, 'morning', 2::smallint, :'y', :'rad', 2::smallint, 'evening', 2::smallint) = 2, 'copy subjects to evening');
select t.ok((select count(*) = 2 and bool_and(status = 'draft') from public.subjects where shift = 'evening'), 'copied subjects are drafts');

-- ===== الدور الثاني (السعي ثابت) =====
:as_radhead
select id as st3 from public.students where department_id = :'rad' and seq = 3 \gset
select public.save_grades(:'s2', format('[{"student_id":"%s","cw_theory":10,"final_theory":20}]', :'st3')::jsonb);
select t.expect_error(format($$select public.save_grades(%L, '[{"student_id":"%s","cw_theory":10,"final_theory":20,"r2_final_theory":50}]')$$, :'s2', :'st3'), '%اعتماد نتائج الدور الأول%');
select t.expect_error(format($$select public.set_subject_status(%L, 'submitted', null, 2::smallint)$$, :'s2'), '%اعتماد نتائج الدور الأول%');
select public.set_subject_status(:'s2', 'submitted');
:as_cmt
select public.set_subject_status(:'s2', 'approved');
:as_radhead
select public.save_grades(:'s2', format('[{"student_id":"%s","cw_theory":10,"final_theory":20,"r2_final_theory":50}]', :'st3')::jsonb);
select t.ok((select public.grade_r2_total(s, g) from public.subjects s join public.grades g on g.subject_id = s.id
             where s.id = :'s2' and g.student_id = :'st3') = 60, 'round-2 total = fixed coursework + round-2 final');
select public.save_grades(:'s2', format('[{"student_id":"%s","special":"absent","cw_theory":20,"r2_final_theory":40}]', :'st2')::jsonb);
select t.expect_error(format($$select public.save_grades(%L, '[{"student_id":"%s","cw_theory":25,"final_theory":60,"r2_final_theory":50}]')$$, :'s2', :'st1'), '%ناجح في الدور الأول%');
select t.expect_error(format($$select public.save_grades(%L, '[{"student_id":"%s","cw_theory":10,"final_theory":20,"r2_final_theory":80}]')$$, :'s2', :'st3'), '%بين 0 و 70%');
select t.expect_error(format($$select public.save_grades(%L, '[{"student_id":"%s","cw_theory":12,"final_theory":20,"r2_final_theory":50}]')$$, :'s2', :'st3'), '%معتمدة%');
select t.ok((select n_r2_needed = 2 and n_r2_done = 2 and r2_status = 'draft' from public.subject_progress where subject_id = :'s2'),
            'progress counts round-2 students');
select t.expect_error(format($$update public.subjects set r2_status = 'approved' where id = %L$$, :'s2'), '%أزرار%');
select public.set_subject_status(:'s2', 'submitted', null, 2::smallint);
select t.expect_error(format($$select public.save_grades(%L, '[{"student_id":"%s","cw_theory":10,"final_theory":20,"r2_final_theory":55}]')$$, :'s2', :'st3'), '%الدور الثاني مرسلة%');
:as_cmt
select public.set_subject_status(:'s2', 'approved', null, 2::smallint);
select t.ok((select status = 'approved' and r2_status = 'approved' from public.subjects where id = :'s2'), 'round 2 approved');
select t.ok((select count(*) = 1 from public.audit_log where action = 'subject.approved' and (details ->> 'round')::int = 2), 'round-2 approval audited');
:as_admin
update public.settings set second_round_cap = 50 where id = 1;
select t.ok((select public.grade_r2_total(s, g) from public.subjects s join public.grades g on g.subject_id = s.id
             where s.id = :'s2' and g.student_id = :'st3') = 50, 'second-round cap applied');
update public.settings set second_round_cap = null where id = 1;

-- ===== الخطة الدراسية =====
select t.ok((select count(*) from public.curriculum c join public.departments d on d.id = c.department_id where d.code = 'CHT') = 31,
            'CHT study plan seeded (31 subjects)');
select t.ok((select sum(units) from public.curriculum c join public.departments d on d.id = c.department_id
             where d.code = 'CHT' and stage = 2 and term = 1) = 24, 'stage 2 / term 1 = 24 units');
:as_radhead
insert into public.curriculum (department_id, stage, term, name, units) values (:'rad', 2, 1, 'مادة من الخطة', 3);
select t.expect_error(format($$insert into public.curriculum (department_id, stage, term, name, units) values (%L, 1, 1, 'x', 1)$$, :'ans'), '%row-level security%');
:as_t1
select count(*) as cur_n from public.curriculum \gset
delete from public.curriculum;
select t.ok((select count(*) from public.curriculum) = :cur_n and :cur_n > 0, 'teachers read but cannot change the study plan');

-- ===== كلمات المرور =====
:as_t1
select t.expect_error($$select public.change_my_password('wrong', 'abcdef1')$$, '%غير صحيحة%');
select public.change_my_password('secret123', 'abcdef1');
reset role;
select t.ok((select encrypted_password = extensions.crypt('abcdef1', encrypted_password) from auth.users where id = :'t1_id'), 'password changed');
select t.ok((select not must_change_password from public.profiles where id = :'t1_id'), 'must_change cleared');

-- ===== إدارة الحسابات =====
:as_admin
select t.expect_error(format($$select public.update_account(%L, 'مدير', null, 'admin', null, false)$$, :'admin_id'), '%صلاحية%');
:as_dean
select t.expect_error(format($$select public.update_account(%L, 'مدير', null, 'admin', null, false)$$, :'admin_id'), '%صلاحية%');
select public.update_account(:'t2_id', 'تدريسي التخدير', 'م.د', 'teacher', :'ans', false);
reset role;
select t.ok((select banned_until > now() + interval '50 years' from auth.users where id = :'t2_id'), 'deactivated user banned');
select t.ok((select encrypted_password like '$2a$10$%' from auth.users where id = :'t3_id'), 'bcrypt cost 10');
:as_t2
select t.ok(public.my_role() is null, 'inactive user has no role');
select t.ok((select count(*) from public.departments) = 5, 'departments readable');
:as_dean
select public.delete_account(:'t1_id');
select t.ok((select teacher_ids = '{}' from public.subjects where id = :'s1'), 'deleted teacher removed from subject');
:as_asst
select t.expect_error(format($$select public.delete_account(%L)$$, :'t3_id'), '%مدير النظام والعميد%');

-- ===== حماية إضافية حتى لو مُنحت صلاحية التنفيذ خطأً (مثلاً بعد استعادة نسخة احتياطية) =====
reset role;
grant execute on function public._create_user(text, text, text, text, uuid, text) to authenticated;
grant execute on function public.write_audit(text, text, text, uuid, text, jsonb) to authenticated;
:as_anshead
select t.expect_error($$select public._create_user('intruder', 'secret123', 'مستخدم دخيل', 'admin', null, null)$$, '%صلاحية%');
select t.expect_error($$select public.write_audit('grade.update', 'grade', null, null, 'سجل مزيف', null)$$, '%permission denied%');
select public.create_account('ans05', 'secret123', 'تدريسي عبر الواجهة', 'teacher');
reset role;
revoke execute on function public._create_user(text, text, text, text, uuid, text) from authenticated;
revoke execute on function public.write_audit(text, text, text, uuid, text, jsonb) from authenticated;
select t.ok((select count(*) = 0 from auth.users where email = 'intruder@exam.local'), 'no intruder account');
select t.ok((select count(*) = 0 from public.audit_log where summary = 'سجل مزيف'), 'no forged audit entry');
select t.ok((select department_id from public.profiles where username = 'ans05') = :'ans', 'legit account via RPC still works');

-- ===== المستخدم المجهول =====
reset role;
set role anon;
select t.expect_error($$select count(*) from public.departments$$, '%permission denied%');
select t.expect_error($$select public.save_grades(gen_random_uuid(), '[]')$$, '%permission denied%');

-- ===== الإعدادات =====
:as_asst
update public.settings set pass_mark = 60 where id = 1;
select t.ok((select pass_mark from public.settings) = 50, 'assistant dean cannot change settings (silently filtered)');
:as_admin
update public.settings set rounding = 'ceil' where id = 1;
select t.ok((select count(*) >= 1 from public.audit_log where action = 'settings.update' and details -> 'new' ->> 'rounding' = 'ceil'), 'settings audited');
select t.ok((select count(*) >= 2 from public.audit_log where action in ('entry.close','entry.open')), 'lock audited');

-- ===== حذف السنة (تسلسلي) =====
:as_dean
delete from public.academic_years where id = :'y';
select t.ok((select count(*) from public.grades) = 0, 'year delete cascades');

reset role;
\o
select 'ALL TESTS PASSED' as result;
