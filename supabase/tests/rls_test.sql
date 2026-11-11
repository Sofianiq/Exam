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
             where s.id = :'s2' and g.student_id = :'st3') = 50, 'round-2 total = coursework + round-2 final − 10 (not below the pass mark)');
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
update public.settings set second_round_deduction = 0 where id = 1;
select t.ok((select public.grade_r2_total(s, g) from public.subjects s join public.grades g on g.subject_id = s.id
             where s.id = :'s2' and g.student_id = :'st3') = 60, 'round-2 total = fixed coursework + round-2 final');
update public.settings set second_round_cap = 55 where id = 1;
select t.ok((select public.grade_r2_total(s, g) from public.subjects s join public.grades g on g.subject_id = s.id
             where s.id = :'s2' and g.student_id = :'st3') = 55, 'second-round cap applied');
update public.settings set second_round_cap = null, second_round_deduction = 10 where id = 1;
-- خصم 10 درجات من الناجح في الدور الثاني: 20 + 50 = 70 ← 60، ولا خصم على المؤجل بعذر
select t.ok((select public.grade_r2_total(s, g) from public.subjects s join public.grades g on g.subject_id = s.id
             where s.id = :'s2' and g.student_id = :'st2') = 50, 'absent student: 20 + 40 = 60 − 10 = 50');

-- ===== الخطة الدراسية =====
select t.ok((select count(*) from public.curriculum c join public.departments d on d.id = c.department_id where d.code = 'CHT') = 56,
            'CHT study plan seeded (4 stages, 56 subjects)');
select t.ok((select count(*) from public.curriculum) = 218, 'study plans of 4 departments seeded (218 subjects)');
select t.ok((select sum(units) from public.curriculum c join public.departments d on d.id = c.department_id
             where d.code = 'ANS' and stage = 2 and term = 1) = 29, 'anesthesia stage 2 / term 1 = 29 units');
select t.ok((select sum(units) from public.curriculum c join public.departments d on d.id = c.department_id
             where d.code = 'CHT' and stage = 2 and term = 1) = 24, 'stage 2 / term 1 = 24 units');
:as_radhead
insert into public.curriculum (department_id, stage, term, name, units) values (:'rad', 2, 1, 'مادة من الخطة', 3);
select t.expect_error(format($$insert into public.curriculum (department_id, stage, term, name, units) values (%L, 1, 1, 'x', 1)$$, :'ans'), '%row-level security%');
:as_t1
select count(*) as cur_n from public.curriculum \gset
delete from public.curriculum;
select t.ok((select count(*) from public.curriculum) = :cur_n and :cur_n > 0, 'teachers read but cannot change the study plan');

-- ===== المواد التقويمية (الوزارية) =====
:as_radhead
insert into public.subjects (year_id, department_id, stage, shift, term, name, units, teacher_ids, coursework_max, cw_practical_max, practical_max, ministerial, final_min)
values (:'y', :'rad', 2, 'morning', 2, 'مادة وزارية', 3, array[:'t1_id']::uuid[], 40, 0, 0, true, 30) returning id as sm \gset
select t.expect_error(format($$update public.subjects set final_min = 70 where id = %L$$, :'sm'), '%final_min%');
:as_t1
select public.save_grades(:'sm', format('[{"student_id":"%s","cw_theory":35,"final_theory":29},{"student_id":"%s","cw_theory":20,"final_theory":30}]', :'st1', :'st2')::jsonb);
reset role;
select t.ok((select public.grade_total(s, g) = 64 and public.grade_passed(s, g) = false
             from public.subjects s join public.grades g on g.subject_id = s.id where s.id = :'sm' and g.student_id = :'st1'),
            'ministerial: 35 + 29 = 64 but fails (final < 30/60)');
select t.ok((select public.grade_passed(s, g) from public.subjects s join public.grades g on g.subject_id = s.id
             where s.id = :'sm' and g.student_id = :'st2'), 'ministerial: 20 + 30 = 50 passes');
select t.ok((select n_pass = 1 and n_fail = 1 and n_r2_needed >= 1 from public.subject_progress where subject_id = :'sm'),
            'progress counts the ministerial failure');
:as_t1
select public.set_subject_status(:'sm', 'submitted');
:as_cmt
select public.set_subject_status(:'sm', 'approved');
:as_t1
select public.save_grades(:'sm', format('[{"student_id":"%s","cw_theory":35,"final_theory":29,"r2_final_theory":31}]', :'st1')::jsonb);
select t.expect_error(format($$select public.save_grades(%L, '[{"student_id":"%s","cw_theory":20,"final_theory":30,"r2_final_theory":40}]')$$, :'sm', :'st2'), '%ناجح في الدور الأول%');
reset role;
select t.ok((select public.grade_r2_total(s, g) = 56 and public.grade_r2_passed(s, g) from public.subjects s join public.grades g on g.subject_id = s.id
             where s.id = :'sm' and g.student_id = :'st1'), 'ministerial failure may sit the second round (35 + 31 = 66 − 10)');

-- ===== حجب الدرجات عن التدريسي عند غلق الإدخال =====
:as_t1
select t.ok((select count(*) > 0 from public.grades where subject_id = :'sm'), 'teacher sees grades while entry is open');
:as_asst
select public.set_entry_open(false, :'rad');
:as_t1
select t.ok((select count(*) = 0 from public.grades), 'teacher sees no grades after entry is closed');
select t.ok((select coalesce(sum(n_complete), 0) = 0 from public.subject_progress), 'teacher progress reveals no grades');
select t.expect_error(format($$select public.save_grades(%L, '[{"student_id":"%s","cw_theory":20}]')$$, :'sm', :'st2'), '%مغلق%');
:as_radhead
select t.ok((select count(*) > 0 from public.grades where subject_id = :'sm'), 'head still sees the grades');
:as_admin
update public.settings set hide_grades_when_closed = false where id = 1;
:as_t1
select t.ok((select count(*) > 0 from public.grades where subject_id = :'sm'), 'hiding can be switched off in settings');
:as_admin
update public.settings set hide_grades_when_closed = true where id = 1;
:as_asst
select public.set_entry_open(true, :'rad');

-- ===== الإعلانات =====
:as_dean
insert into public.announcements (title, body, level) values ('إعلان عام', 'لكل المستخدمين', 'important') returning id as an1 \gset
insert into public.announcements (title, body, audience) values ('للمقررين فقط', '', 'heads');
:as_radhead
insert into public.announcements (title, body, department_id, audience) values ('إعلان قسم الأشعة', 'لتدريسيي القسم', :'rad', 'teachers') returning id as an2 \gset
select t.expect_error(format($$insert into public.announcements (title, department_id) values ('x', %L)$$, :'ans'), '%صلاحية%');
select t.expect_error($$insert into public.announcements (title) values ('للكلية')$$, '%صلاحية%');
select t.ok((select created_by_name from public.announcements where id = :'an2') = 'مقرر الأشعة', 'author name stamped');
:as_t1
select t.ok((select count(*) from public.announcements) = 2, 'teacher reads college + own department announcements');
select t.expect_error($$insert into public.announcements (title) values ('x')$$, '%صلاحية%');
update public.announcements set title = 'تلاعب' where id = :'an1';
select t.ok((select title from public.announcements where id = :'an1') = 'إعلان عام', 'teacher cannot edit announcements');
:as_t2
select t.ok((select count(*) from public.announcements) = 1, 'other department teacher does not see the RAD announcement');
:as_anshead
select t.ok((select count(*) from public.announcements) = 2, 'heads see the heads-only announcement');
:as_dean
update public.announcements set expires_at = now() - interval '1 day' where id = :'an2';
:as_t1
select t.ok((select count(*) from public.announcements) = 1, 'expired announcements disappear');
:as_radhead
delete from public.announcements where id = :'an2';
reset role;
select t.ok((select count(*) from public.audit_log where action like 'announcement.%') >= 4, 'announcements audited');

-- ===== التدريسي في أكثر من قسم =====
:as_anshead
select public.set_teacher_departments(:'t1_id', array[:'ans']::uuid[]);
select t.ok((select :'ans' = any (extra_department_ids) from public.profiles where id = :'t1_id'), 'head links a teacher from another department');
select t.expect_error(format($$select public.set_teacher_departments(%L, array[%L]::uuid[])$$, :'t2_id', :'rad'), '%صلاحية%');
select public.set_teacher_departments(:'t1_id', '{}');
select t.ok((select cardinality(extra_department_ids) = 0 from public.profiles where id = :'t1_id'), 'head unlinks the teacher');
insert into public.subjects (year_id, department_id, stage, shift, term, name, teacher_ids)
values (:'y', :'ans', 1, 'morning', 1, 'مادة مشتركة', array[:'t1_id']::uuid[]) returning id as sx \gset
select t.ok((select :'ans' = any (extra_department_ids) from public.profiles where id = :'t1_id'), 'assigning a subject links the teacher to its department');
insert into public.announcements (title, department_id, audience) values ('إعلان التخدير', :'ans', 'teachers');
:as_t1
select t.ok((select count(*) from public.announcements where title = 'إعلان التخدير') = 1, 'linked teacher receives the department announcements');
select t.ok((select count(*) from public.subjects where id = :'sx') = 1, 'teacher sees the subject in the other department');
select t.expect_error(format($$select public.set_teacher_departments(%L, '{}')$$, :'t1_id'), '%صلاحية%');
:as_admin
select public.set_teacher_departments(:'t1_id', array[:'ans', :'rad']::uuid[]);
select t.ok((select extra_department_ids = array[:'ans']::uuid[] from public.profiles where id = :'t1_id'), 'home department is never duplicated');
select t.ok((select count(*) >= 2 from public.audit_log where action = 'user.departments'), 'department links audited');

-- ===== التحقق من النتيجة برمز QR =====
:as_radhead
insert into public.subjects (year_id, department_id, stage, shift, term, name, teacher_ids, coursework_max, cw_practical_max, practical_max)
values (:'y', :'rad', 2, 'morning', 1, 'مادة غير معتمدة', array[:'t1_id']::uuid[], 30, 0, 0) returning id as su \gset
:as_t1
select public.save_grades(:'su', format('[{"student_id":"%s","cw_theory":25,"final_theory":60}]', :'st1')::jsonb);
reset role;
select verify_code as vc from public.students where id = :'st1' \gset
select t.ok(length(:'vc') = 16, 'every student has a 16-character verification code');
set role anon;
select t.ok((public.verify_result(:'vc') -> 'student' ->> 'full_name') is not null, 'anyone can verify a result by its code');
select t.ok((select (x ->> 'total')::numeric = 64 and (x ->> 'passed')::boolean = false
             from jsonb_array_elements(public.verify_result(:'vc') -> 'subjects') x where x ->> 'name' = 'مادة وزارية'),
            'verification shows the approved (ministerial) result');
select t.ok((select x ->> 'total' is null and x ->> 'passed' is null and not (x ->> 'approved')::boolean
             from jsonb_array_elements(public.verify_result(:'vc') -> 'subjects') x where x ->> 'name' = 'مادة غير معتمدة'),
            'unapproved subjects reveal no grades');
select t.ok((select x ->> 'r2_total' is null from jsonb_array_elements(public.verify_result(:'vc') -> 'subjects') x
             where x ->> 'name' = 'مادة وزارية'), 'unapproved second round reveals nothing');
select t.ok(public.verify_result('0000000000000000') is null, 'unknown code returns nothing');
select t.ok(public.verify_result(lower(:'vc')) is not null, 'verification code is case-insensitive');
select t.expect_error($$select count(*) from public.students$$, '%permission denied%');
:as_radhead
update public.students set verify_code = 'AAAAAAAAAAAAAAAA' where id = :'st1';
reset role;
select t.ok((select verify_code from public.students where id = :'st1') = :'vc', 'verification code cannot be changed');

-- ===== بيانات النظام السابق المرحَّلة (أُزيلت أداة الترحيل وبقيت البيانات) =====
:as_admin
select t.expect_error($$select public.import_legacy_class('{}'::jsonb)$$, '%does not exist%');
-- محاكاة بيانات مرحَّلة كما أنشأتها أداة الترحيل سابقاً
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id')::text, false);
select set_config('app.legacy_import', 'on', false);
select set_config('app.status_rpc', 'on', false);
insert into public.academic_years (label) values ('2024-2025') returning id as ly \gset
insert into public.legacy_imports (year_id, department_id, stage, shift, checksum) values (:'ly', :'rad', 1, 'morning', 'x') returning id as lbatch \gset
insert into public.students (year_id, department_id, stage, shift, seq, full_name, student_no, gender, legacy_import_id)
values (:'ly', :'rad', 1, 'morning', 1, 'طالب أول تجريبي', '2501', 'female', :'lbatch'),
       (:'ly', :'rad', 1, 'morning', 2, 'طالب ثانٍ تجريبي', '2502', 'male', :'lbatch');
select id as ls1 from public.students where year_id = :'ly' and student_no = '2501' \gset
select id as ls2 from public.students where year_id = :'ly' and student_no = '2502' \gset
insert into public.subjects (year_id, department_id, stage, shift, term, name, units, coursework_max, cw_practical_max, practical_max,
                             status, r2_status, legacy, r2_deduction, legacy_import_id)
values (:'ly', :'rad', 1, 'morning', 1, 'مادة علمية', 3, 40, 0, 0, 'approved', 'approved', true, 10, :'lbatch') returning id as lsa \gset
insert into public.subjects (year_id, department_id, stage, shift, term, name, units, coursework_max, cw_practical_max, practical_max,
                             status, r2_status, legacy, r2_deduction, legacy_import_id)
values (:'ly', :'rad', 1, 'morning', 1, 'لغة عربية', 2, 30, 0, 0, 'approved', 'approved', true, 10, :'lbatch') returning id as lsb \gset
insert into public.grades (subject_id, student_id, cw_theory, final_theory, decision, special, r2_final_theory, r2_decision, final_override, legacy) values
  (:'lsa', :'ls1', 18, 27, 5, null, null, null, null, null),
  (:'lsa', :'ls2', 38, null, null, 'banned', 54, null, null, null),
  (:'lsb', :'ls1', 26, 65, null, null, null, null, 40, '{"fixed": "تسوية"}'),
  (:'lsb', :'ls2', 20, 10, null, null, 26, 4, null, null);
select set_config('app.legacy_import', '', false);
select set_config('app.status_rpc', '', false);
select t.ok((select final_max = 70 from public.subjects where id = :'lsb'), 'per-subject 30/70 distribution kept');
select t.ok((select public.grade_total(s, g) = 50 and public.grade_passed(s, g) from public.subjects s join public.grades g on g.subject_id = s.id
             where s.id = :'lsa' and g.student_id = :'ls1'), 'decision marks count towards the total (18 + 27 + 5 = 50)');
select t.ok((select public.grade_r2_total(s, g) = 82 from public.subjects s join public.grades g on g.subject_id = s.id
             where s.id = :'lsa' and g.student_id = :'ls2'), 'banned in round 1: 38 + 54 = 92 − 10 = 82');
select t.ok((select public.grade_r2_total(s, g) = 50 from public.subjects s join public.grades g on g.subject_id = s.id
             where s.id = :'lsb' and g.student_id = :'ls2'), 'round-2 decision: 20 + 26 + 4 = 50 stays 50');
-- حماية البيانات المرحَّلة
:as_radhead
select t.ok((select count(*) = 0 from public.legacy_imports), 'department heads cannot read the migration log');
select t.expect_error(format($$update public.grades set decision = 9 where subject_id = %L$$, :'lsa'), '%الإدارة فقط%');
insert into public.subjects (year_id, department_id, stage, shift, term, name, legacy) values (:'ly', :'rad', 1, 'morning', 2, 'مادة جديدة', true) returning id as lnew \gset
select t.ok((select not legacy and legacy_import_id is null from public.subjects where id = :'lnew'), 'the legacy flag cannot be set from the application');
:as_admin
select t.ok((select count(*) = 1 from public.legacy_imports), 'the migration log is kept');
select verify_code as lcode from public.students where id = :'ls1' \gset
select t.ok((select (x ->> 'override')::numeric = 40 from jsonb_array_elements(public.verify_result(:'lcode') -> 'subjects') x where x ->> 'name' = 'لغة عربية'),
            'verification exposes the fixed final mark');
select verify_code as lcode2 from public.students where id = :'ls2' \gset
select t.ok((select (x ->> 'r2_by_decision')::boolean from jsonb_array_elements(public.verify_result(:'lcode2') -> 'subjects') x where x ->> 'name' = 'لغة عربية'),
            'verification flags passes by decision');
delete from public.academic_years where id = :'ly';

-- ===== بوابة الطالب =====
:as_t1
select t.expect_error(format($$select public.portal_overview(%L)$$, :'y'), '%صلاحية%');
select t.expect_error(format($$select public.portal_cards(%L, %L, 2::smallint, 'morning')$$, :'y', :'rad'), '%صلاحية%');
:as_anshead
select t.expect_error(format($$select public.portal_generate_accounts(%L, %L)$$, :'y', :'rad'), '%صلاحية%');
:as_radhead
select t.ok((public.portal_generate_accounts(:'y', :'rad', 2::smallint, 'morning') ->> 'created')::int
            = (select count(*) from public.students where department_id = :'rad' and status = 'active'), 'an account for every active student');
select t.ok((public.portal_generate_accounts(:'y', :'rad') ->> 'created')::int = 0, 'generating again creates nothing');
select t.ok((select bool_and(x ->> 'login_id' ~ '^[1-9]\d{6}$' and x ->> 'code' ~ '^\d{8}$')
             from jsonb_array_elements(public.portal_cards(:'y', :'rad', 2::smallint, 'morning')) x), 'cards: 7-digit login and 8-digit code');
select x ->> 'login_id' as plogin, x ->> 'code' as pcode
  from jsonb_array_elements(public.portal_cards(:'y', :'rad', 2::smallint, 'morning')) x where x ->> 'student_id' = :'st1' \gset
select t.ok((select (c ->> 'accounts')::int >= 3 from jsonb_array_elements(public.portal_overview(:'y') -> 'classes') c), 'head sees own department in the overview');
select t.expect_error(format($$select public.portal_publish(jsonb_build_object('year_id', %L, 'department_id', %L, 'stage', 2, 'shift', 'morning', 'term', 1, 'kind', 'coursework', 'snapshots', '[]'::jsonb))$$, :'y', :'rad'),
                      '%مدير النظام أو العميد%');
select t.expect_error($$select count(*) from public.portal_accounts$$, '%permission denied%');
:as_admin
select t.expect_error(format($$select public.portal_publish(jsonb_build_object('year_id', %L, 'department_id', %L, 'stage', 2, 'shift', 'morning', 'term', 0, 'kind', 'coursework', 'snapshots', '[]'::jsonb))$$, :'y', :'rad'),
                      '%غير صالحة%');
select t.expect_error(format($$select public.portal_publish(jsonb_build_object('year_id', %L, 'department_id', %L, 'stage', 2, 'shift', 'morning', 'term', 1, 'kind', 'coursework',
                      'snapshots', jsonb_build_array(jsonb_build_object('student_id', gen_random_uuid(), 'data', '{}'::jsonb))))$$, :'y', :'rad'), '%ليس من هذا الصف%');
select t.ok((public.portal_publish(jsonb_build_object('year_id', :'y', 'department_id', :'rad', 'stage', 2, 'shift', 'morning', 'term', 1, 'kind', 'coursework',
             'exam_url', 'https://exam.example/', 'snapshots', jsonb_build_array(jsonb_build_object('student_id', :'st1',
               'data', jsonb_build_object('v', 1, 'subjects', jsonb_build_array(jsonb_build_object('name', 'مادة', 'cw', 32, 'max', 40))))))) ->> 'students')::int = 1,
            'coursework published');
select t.ok((select count(*) = 1 from public.audit_log where action = 'portal.publish') and (select count(*) = 1 from public.audit_log where action = 'portal.accounts'),
            'portal actions audited');
insert into public.announcements (title, body, audience, department_id) values ('إعلان للطلبة', 'نص', 'students', null);
:as_t1
select t.ok((select count(*) = 0 from public.announcements where audience = 'students'), 'student announcements are not shown to teachers');

-- الطالب: يدخل دون حساب في نظام اللجنة
reset role;
set role anon;
select t.expect_error($$select count(*) from public.portal_snapshots$$, '%permission denied%');
select t.expect_error($$select count(*) from public.students$$, '%permission denied%');
select t.expect_error($$select public.portal_payload(gen_random_uuid())$$, '%permission denied%');
select t.ok((public.portal_login(:'plogin', '00000000') ->> 'code') = 'invalid', 'wrong code rejected');
select t.ok((public.portal_login('٠٠٠١', 'x') ->> 'ok')::boolean = false, 'unknown login rejected');
select public.portal_login(:'plogin', :'pcode') as plog \gset
select t.ok((:'plog'::jsonb ->> 'ok')::boolean, 'student logs in with the printed card');
select :'plog'::jsonb ->> 'token' as ptoken \gset
select t.ok((select r ->> 'full_name' = 'احمد كريم جواد' and r ->> 'department' is not null and jsonb_array_length(r -> 'items') = 1
                    and (r -> 'items' -> 0 -> 'data' -> 'subjects' -> 0 ->> 'cw')::int = 32
             from jsonb_array_elements(:'plog'::jsonb -> 'data' -> 'records') r), 'payload: own record with the published coursework only');
select t.ok(:'plog'::jsonb -> 'data' -> 'announcements' -> 0 ->> 'title' = 'إعلان للطلبة', 'payload carries student announcements');
select t.ok(:'plog'::jsonb -> 'data' ->> 'exam_url' = 'https://exam.example/', 'payload carries the verification base url');
select t.ok(position('cw_theory' in :'plog') = 0 and position('final_theory' in :'plog') = 0, 'no raw grade components reach the student');
select t.ok((public.portal_me(:'ptoken') ->> 'ok')::boolean and (public.portal_me('bad-token') ->> 'code') = 'session', 'session token required');
-- الأرقام العربية والفراغات مقبولة
select t.ok((public.portal_login(translate(:'plogin', '0123456789', '٠١٢٣٤٥٦٧٨٩'), substr(:'pcode', 1, 4) || ' ' || substr(:'pcode', 5)) ->> 'ok')::boolean,
            'arabic digits and spaces accepted');
-- تغيير الرمز
select t.ok((public.portal_change_code(:'ptoken', 'wrong', 'newcode1') ->> 'code') = 'invalid', 'current code required to change');
select t.ok((public.portal_change_code(:'ptoken', :'pcode', '123') ->> 'code') = 'weak', 'short codes rejected');
select t.ok((public.portal_change_code(:'ptoken', :'pcode', 'سري-2026') ->> 'ok')::boolean, 'student changes the code');
select t.ok((public.portal_login(:'plogin', :'pcode') ->> 'ok')::boolean = false and (public.portal_login(:'plogin', 'سري-2026') ->> 'ok')::boolean,
            'old code stops working, new code works');
-- الحد من التخمين
select public.portal_login(:'plogin', 'bad' || g) from generate_series(1, 5) g;
select t.ok((public.portal_login(:'plogin', 'سري-2026') ->> 'code') = 'locked', 'locked after repeated wrong codes');
reset role;
select t.ok((select initial_code is null and code_changed_at is not null from public.portal_accounts where login_id = :'plogin'), 'printed code erased after the change');
:as_radhead
select t.ok((select (x ->> 'code') is null and (x ->> 'changed')::boolean from jsonb_array_elements(public.portal_cards(:'y', :'rad', 2::smallint, 'morning')) x
             where x ->> 'student_id' = :'st1'), 'cards hide a code the student changed');
select public.portal_reset_code(:'st1') ->> 'code' as pcode2 \gset
reset role;
set role anon;
select t.ok((public.portal_me(:'ptoken') ->> 'code') = 'session', 'reset signs the student out');
select public.portal_login(:'plogin', :'pcode2') as plog2 \gset
select t.ok((:'plog2'::jsonb ->> 'ok')::boolean, 'reset clears the lock and gives a new code');
select :'plog2'::jsonb ->> 'token' as ptoken2 \gset
-- حجب نتيجة طالب مؤقتاً: تختفي النتيجة ورمز التحقق من البوابة وصفحة التحقق، ويبقى السعي
:as_admin
select t.ok((public.portal_publish(jsonb_build_object('year_id', :'y', 'department_id', :'rad', 'stage', 2, 'shift', 'morning', 'term', 1, 'kind', 'results',
             'snapshots', jsonb_build_array(jsonb_build_object('student_id', :'st1', 'data', jsonb_build_object('v', 1, 'status', 'pass'))))) ->> 'students')::int = 1,
            'results published');
select verify_code as vcode from public.students where id = :'st1' \gset
:as_radhead
select t.expect_error(format($$select public.set_result_withheld(%L, true, 'x')$$, :'st1'), '%الإدارة واللجنة%');
update public.students set result_withheld = true, withheld_reason = 'تجاوز' where id = :'st1';
select t.ok((select not result_withheld and withheld_reason is null from public.students where id = :'st1'), 'withholding cannot be set by a direct update');
:as_t1
select t.expect_error(format($$select public.set_result_withheld(%L, true, null)$$, :'st1'), '%الإدارة واللجنة%');
reset role;
set role anon;
select t.ok((select jsonb_array_length(r -> 'items') = 2 and r ->> 'verify_code' = :'vcode' and not (r ->> 'withheld')::boolean
             from jsonb_array_elements(public.portal_login(:'plogin', :'pcode2') -> 'data' -> 'records') r), 'before withholding: coursework + result + verify code');
select t.ok((select jsonb_array_length(public.verify_result(:'vcode') -> 'subjects') > 0 and not (public.verify_result(:'vcode') ->> 'withheld')::boolean), 'verify page shows the result');
:as_cmt
select public.set_result_withheld(:'st1', true, '  يرجى مراجعة اللجنة الامتحانية  ');
select t.ok((select result_withheld and withheld_reason = 'يرجى مراجعة اللجنة الامتحانية' and withheld_at is not null and withheld_by_name is not null
             from public.students where id = :'st1'), 'committee withholds a result with a note');
select t.ok((select w ->> 'student_id' = :'st1' and w ->> 'reason' is not null from jsonb_array_elements(public.portal_overview(:'y') -> 'withheld') w), 'overview lists withheld results');
:as_radhead
update public.students set notes = 'ملاحظة' where id = :'st1';
select t.ok((select result_withheld and notes = 'ملاحظة' from public.students where id = :'st1'), 'other edits keep the withholding');
reset role;
set role anon;
select t.ok((select jsonb_array_length(r -> 'items') = 1 and r -> 'items' -> 0 ->> 'kind' = 'coursework' and r ->> 'verify_code' is null
                    and (r ->> 'withheld')::boolean and r ->> 'withheld_note' = 'يرجى مراجعة اللجنة الامتحانية'
             from jsonb_array_elements(public.portal_me(:'ptoken2') -> 'data' -> 'records') r), 'withheld: result and verify code hidden, coursework stays');
select t.ok((select (v ->> 'withheld')::boolean and jsonb_array_length(v -> 'subjects') = 0 and v -> 'student' ->> 'full_name' is not null
             from public.verify_result(:'vcode') v), 'verify page reports a withheld result without grades');
:as_cmt
select public.set_result_withheld(:'st1', false);
select t.ok((select not result_withheld and withheld_reason is null and withheld_at is null from public.students where id = :'st1'), 'withholding lifted');
reset role;
set role anon;
select t.ok((select jsonb_array_length(r -> 'items') = 2 and r ->> 'verify_code' = :'vcode'
             from jsonb_array_elements(public.portal_me(:'ptoken2') -> 'data' -> 'records') r), 'result is back immediately after lifting');
reset role;
select t.ok((select count(*) = 1 from public.audit_log where action = 'student.withhold') and (select count(*) = 1 from public.audit_log where action = 'student.unwithhold'),
            'withholding audited');
-- سحب النشر وإيقاف البوابة
:as_admin
select public.portal_unpublish(:'y', :'rad', 2::smallint, 'morning', 1::smallint, 'results');
select public.portal_unpublish(:'y', :'rad', 2::smallint, 'morning', 1::smallint, 'coursework');
select t.ok(jsonb_array_length(public.portal_overview(:'y') -> 'publications') = 0, 'unpublished');
select public.portal_save_settings(false, 'https://portal.example/', null, 'رسالة');
reset role;
set role anon;
select t.ok((public.portal_login(:'plogin', :'pcode2') ->> 'code') = 'closed', 'portal can be closed temporarily');
:as_admin
select public.portal_save_settings(true, 'https://portal.example/', null, null);
select t.ok((select exam_url = 'https://exam.example/' and portal_url = 'https://portal.example/' from jsonb_to_record(public.portal_overview(:'y') -> 'settings') as x(exam_url text, portal_url text)),
            'settings kept');
-- الطالب نفسه في سنة لاحقة يحتفظ بحسابه (بالاسم في القسم نفسه)
insert into public.academic_years (label) values ('2027-2028') returning id as y2 \gset
select public.add_students(:'y2', :'rad', 3::smallint, 'morning', array['احمد كريم جواد', 'طالب جديد تماماً']);
select t.ok((select r ->> 'created' = '1' and r ->> 'linked' = '1' from public.portal_generate_accounts(:'y2', :'rad') r), 'returning student keeps the same account');
reset role;
set role anon;
select t.ok((select jsonb_array_length(public.portal_login(:'plogin', :'pcode2') -> 'data' -> 'records') = 2), 'the student sees both years');
:as_admin
delete from public.academic_years where id = :'y2';
delete from public.announcements where audience = 'students';

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
