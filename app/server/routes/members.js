import { Router } from 'express';
import supabase from '../db.js';
import {
  validateStringLengths,
  sanitizeBody,
  validateMemberId,
} from '../middleware/validate.js';
import { coerceJsonArray, serializeJsonArray } from '../utils/json.js';

const router = Router();
const TEXT_FIELDS = ['name', 'full_name', 'email', 'role'];

const PRIORITY_ORDER = { p0: 0, p1: 1, p2: 2, p3: 3 };

function validateMemberArrays(body) {
  const errors = [];

  if (body.businesses !== undefined) {
    if (!Array.isArray(body.businesses) || !body.businesses.every(item => typeof item === 'string')) {
      errors.push('businesses must be an array of strings');
    }
  }

  if (body.aliases !== undefined) {
    if (!Array.isArray(body.aliases) || !body.aliases.every(item => typeof item === 'string')) {
      errors.push('aliases must be an array of strings');
    }
  }

  return errors;
}

router.get('/', async (req, res) => {
  try {
    const { business, is_active } = req.query;
    let query = supabase.from('atlas_members').select('*');

    if (business) {
      query = query.contains('businesses', [business]);
    }
    if (is_active !== undefined) {
      query = query.eq('is_active', parseInt(is_active, 10) === 1);
    }

    query = query.order('name', { ascending: true });

    const { data, error } = await query;
    if (error) throw error;

    res.json(data || []);
  } catch (err) {
    console.error(`[members] GET error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const { data, error } = await supabase.rpc('atlas_member_stats');
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error(`[members] stats error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { data: member, error } = await supabase
      .from('atlas_members')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error || !member) return res.status(404).json({ error: 'Member not found' });

    const { data: statsData, error: statsErr } = await supabase.rpc('atlas_member_detail_stats', {
      member_id_param: req.params.id,
    });
    if (statsErr) throw statsErr;

    member.actionStats = statsData?.actionStats || [];
    member.overdueCount = statsData?.overdueCount || 0;

    res.json(member);
  } catch (err) {
    console.error(`[members] GET/:id error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/actions', async (req, res) => {
  try {
    const { status } = req.query;
    let query = supabase
      .from('atlas_actions')
      .select('*')
      .contains('owners', [req.params.id]);

    if (status) {
      const statuses = status.split(',');
      query = query.in('status', statuses);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Sort by priority then due_date in app
    const sorted = (data || []).sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 3;
      const pb = PRIORITY_ORDER[b.priority] ?? 3;
      if (pa !== pb) return pa - pb;
      if (a.due_date === b.due_date) return 0;
      if (a.due_date === null) return 1;
      if (b.due_date === null) return -1;
      return a.due_date < b.due_date ? -1 : 1;
    });

    res.json(sorted);
  } catch (err) {
    console.error(`[members] /:id/actions error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const body = sanitizeBody(req.body, TEXT_FIELDS);
    const {
      id,
      name,
      full_name = null,
      email = null,
      businesses = [],
      role = null,
      aliases = [],
    } = body;

    if (!id || !name) {
      return res.status(400).json({ error: 'id and name are required' });
    }

    const idErr = validateMemberId(id);
    if (idErr) return res.status(400).json({ error: idErr });

    const validationErrors = [
      ...validateMemberArrays(body),
      ...validateStringLengths(body),
    ];
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors.join('; ') });
    }

    const { data: existingMember } = await supabase
      .from('atlas_members')
      .select('id')
      .eq('id', id)
      .single();
    if (existingMember) {
      return res.status(409).json({ error: 'Member ID already exists' });
    }

    const { data: member, error } = await supabase
      .from('atlas_members')
      .insert({
        id,
        name,
        full_name,
        email,
        businesses: serializeJsonArray(businesses),
        role,
        aliases: serializeJsonArray(aliases),
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json(member);
  } catch (err) {
    console.error(`[members] POST error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { data: existing, error: fetchErr } = await supabase
      .from('atlas_members')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (fetchErr || !existing) return res.status(404).json({ error: 'Member not found' });

    const body = sanitizeBody(req.body, TEXT_FIELDS);
    const {
      name, full_name, email, businesses, role, aliases, is_active,
    } = body;

    const validationErrors = [
      ...validateMemberArrays(body),
      ...validateStringLengths(body),
    ];
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: validationErrors.join('; ') });
    }

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (full_name !== undefined) updates.full_name = full_name;
    if (email !== undefined) updates.email = email;
    if (businesses !== undefined) updates.businesses = serializeJsonArray(businesses);
    if (role !== undefined) updates.role = role;
    if (aliases !== undefined) updates.aliases = serializeJsonArray(aliases);
    if (is_active !== undefined) updates.is_active = is_active;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const { data: member, error } = await supabase
      .from('atlas_members')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) throw error;

    res.json(member);
  } catch (err) {
    console.error(`[members] PUT/:id error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
