/**
 * Science Map Validator and Scientific Gatekeeper
 * Implements deterministic fail-closed validation for scientific reasoning DAGs.
 */

export function validateScienceMap(data, options = {}) {
  const diagnostics = [];
  const { workspaceRoot } = options;

  function addDiagnostic(code, severity, message, subject, evidence, supportedFixes = []) {
    diagnostics.push({
      code,
      severity,
      message,
      subject,
      evidence,
      supportedFixes,
    });
  }

  // 1. Basic Type & Version Check
  if (!data || typeof data !== 'object') {
    return {
      ok: false,
      summary: { errors: 1, warnings: 0 },
      diagnostics: [{
        code: 'schema/root_object',
        severity: 'error',
        message: 'Root specification must be a valid JSON object',
        subject: { path: '/' },
        evidence: { type: typeof data },
        supportedFixes: ['Provide a valid JSON object matching science-map schema'],
      }],
    };
  }

  if (data.schema_version !== 1) {
    addDiagnostic(
      'schema/version',
      'error',
      `schema_version must be 1, received ${data.schema_version}`,
      { path: '/schema_version' },
      { expected: 1, actual: data.schema_version },
      ['Set "schema_version": 1']
    );
  }

  if (data.diagram_type !== 'science_map') {
    addDiagnostic(
      'schema/diagram_type',
      'error',
      `diagram_type must be "science_map", received ${data.diagram_type}`,
      { path: '/diagram_type' },
      { expected: 'science_map', actual: data.diagram_type },
      ['Set "diagram_type": "science_map"']
    );
  }

  // 2. Meta verification
  if (!data.meta || typeof data.meta !== 'object') {
    addDiagnostic('schema/meta_missing', 'error', 'Missing meta configuration block', { path: '/meta' }, {}, ['Add required meta block']);
  } else {
    if (!data.meta.title) {
      addDiagnostic('schema/meta_title', 'error', 'meta.title is required', { path: '/meta/title' }, {}, ['Add non-empty "title" to meta']);
    }
    if (!data.meta.field_of_study) {
      addDiagnostic('schema/meta_field', 'error', 'meta.field_of_study is required', { path: '/meta/field_of_study' }, {}, ['Specify "field_of_study" (e.g. lattice_gauge_theory)']);
    }
  }

  // 3. Node Collection & Id Registry
  const nodeMap = new Map();
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];

  if (nodes.length < 2) {
    addDiagnostic('schema/min_nodes', 'error', `At least 2 nodes required, found ${nodes.length}`, { path: '/nodes' }, { count: nodes.length }, ['Add at least two epistemic nodes']);
  }

  const validCategories = new Set([
    'theoretical_axiom',
    'model_mapping',
    'code_operator',
    'hpc_campaign',
    'observable',
    'refuted_hypothesis',
  ]);

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const path = `/nodes/${i}`;

    if (!node.id || typeof node.id !== 'string') {
      addDiagnostic('schema/node_id', 'error', `Node at index ${i} missing valid string id`, { path: `${path}/id` }, {}, ['Provide a unique string identifier']);
      continue;
    }

    if (nodeMap.has(node.id)) {
      addDiagnostic('schema/duplicate_node_id', 'error', `Duplicate node id "${node.id}"`, { path: `${path}/id`, id: node.id }, { id: node.id }, [`Make id "${node.id}" unique`]);
    }
    nodeMap.set(node.id, node);

    if (!validCategories.has(node.category)) {
      addDiagnostic('schema/invalid_category', 'error', `Invalid category "${node.category}" for node "${node.id}"`, { path: `${path}/category`, id: node.id }, { allowed: Array.from(validCategories), actual: node.category }, [`Use one of ${Array.from(validCategories).join(', ')}`]);
    }

    if (!node.label) {
      addDiagnostic('schema/missing_label', 'error', `Node "${node.id}" missing label`, { path: `${path}/label`, id: node.id }, {}, ['Provide a descriptive label']);
    }

    if (typeof node.col !== 'number' || node.col < 0) {
      addDiagnostic('schema/invalid_col', 'error', `Node "${node.id}" must specify non-negative integer col`, { path: `${path}/col`, id: node.id }, {}, ['Set col: 0, 1, 2...']);
    }

    // --- Scientific Quality Gates ---

    // Gate A: Execution Fidelity Gate for HPC Campaign nodes
    if (node.category === 'hpc_campaign') {
      const execAudit = node.evidence?.execution_audit;
      if (!execAudit) {
        addDiagnostic(
          'gate/hpc_missing_audit',
          'error',
          `HPC campaign node "${node.id}" must contain execution_audit evidence`,
          { path: `${path}/evidence/execution_audit`, id: node.id },
          {},
          ['Add execution_audit with requested vs actual parameters and SLURM Job ID']
        );
      } else {
        if (!execAudit.slurm_script && (!execAudit.slurm_job_ids || execAudit.slurm_job_ids.length === 0)) {
          addDiagnostic(
            'gate/hpc_unverified_job',
            'warning',
            `HPC node "${node.id}" has neither slurm_script nor slurm_job_ids recorded`,
            { path: `${path}/evidence/execution_audit`, id: node.id },
            {},
            ['Record the specific SLURM batch script name or Job IDs']
          );
        }

        // Check discrepancy rationale
        if (execAudit.discrepancy?.has_deviation && (!execAudit.discrepancy.rationale || execAudit.discrepancy.rationale.trim() === '')) {
          addDiagnostic(
            'gate/unexplained_discrepancy',
            'error',
            `HPC node "${node.id}" marks has_deviation: true but provides empty rationale`,
            { path: `${path}/evidence/execution_audit/discrepancy`, id: node.id },
            {},
            ['Explain WHY actual parameters deviated from user request (e.g. V100 GPU OOM, time limits)']
          );
        }
      }
    }

    // Gate B: Code-Physics Grounding Gate
    if (node.category === 'code_operator') {
      const codeRealization = node.evidence?.code_realization;
      if (!codeRealization || !codeRealization.repo_path) {
        addDiagnostic(
          'gate/code_missing_path',
          'error',
          `Code operator node "${node.id}" must declare repo_path under evidence.code_realization`,
          { path: `${path}/evidence/code_realization`, id: node.id },
          {},
          ['Provide relative repo_path (e.g. z3_puregauge_cylinder_tn/src/model.jl)']
        );
      }
      if (codeRealization && (!codeRealization.physical_interpretation || codeRealization.physical_interpretation.trim() === '')) {
        addDiagnostic(
          'gate/code_missing_physics',
          'warning',
          `Code operator "${node.id}" lacks physical_interpretation explaining what Hamiltonian/operator it represents`,
          { path: `${path}/evidence/code_realization/physical_interpretation`, id: node.id },
          {},
          ['Add physical_interpretation explaining the physics behind this code realization']
        );
      }
    }

    // Gate C: Scientific Figure Integrity
    if (node.figure) {
      if (!node.figure.figure_id || !node.figure.title || !node.figure.asset_path) {
        addDiagnostic(
          'gate/invalid_figure_metadata',
          'error',
          `Node "${node.id}" figure drawer must define figure_id, title, and asset_path`,
          { path: `${path}/figure`, id: node.id },
          {},
          ['Provide complete figure specification']
        );
      }
    }
  }

  // 4. Edge Verification & Flow Integrity
  const edges = Array.isArray(data.edges) ? data.edges : [];
  const incomingEdges = new Map();
  const outgoingEdges = new Map();

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const path = `/edges/${i}`;

    if (!edge.id) {
      addDiagnostic('schema/edge_id', 'error', `Edge at index ${i} missing id`, { path }, {}, ['Provide unique edge id']);
    }

    if (!nodeMap.has(edge.from)) {
      addDiagnostic('schema/edge_broken_from', 'error', `Edge "${edge.id}" references non-existent source node "${edge.from}"`, { path: `${path}/from` }, { from: edge.from }, [`Ensure source node "${edge.from}" exists`]);
    }
    if (!nodeMap.has(edge.to)) {
      addDiagnostic('schema/edge_broken_to', 'error', `Edge "${edge.id}" references non-existent target node "${edge.to}"`, { path: `${path}/to` }, { to: edge.to }, [`Ensure target node "${edge.to}" exists`]);
    }

    if (!incomingEdges.has(edge.to)) incomingEdges.set(edge.to, []);
    incomingEdges.get(edge.to).push(edge);

    if (!outgoingEdges.has(edge.from)) outgoingEdges.set(edge.from, []);
    outgoingEdges.get(edge.from).push(edge);
  }

  // Gate D: No Floating Claims Gate
  for (const [id, node] of nodeMap.entries()) {
    if (node.category === 'observable') {
      const incoming = incomingEdges.get(id) || [];
      if (incoming.length === 0) {
        addDiagnostic(
          'gate/floating_observable',
          'error',
          `Observable node "${id}" has no incoming edges. An observable must be measured from an HPC run, simulation, or derivation`,
          { id, path: `/nodes/${id}` },
          {},
          ['Connect an incoming edge with role "measures" from an hpc_campaign or code_operator']
        );
      }
    }

    // Gate E: Refuted Hypothesis Gate
    if (node.category === 'refuted_hypothesis') {
      const incoming = incomingEdges.get(id) || [];
      const hasRefutingEdge = incoming.some(e => e.role === 'refutes');
      if (!hasRefutingEdge) {
        addDiagnostic(
          'gate/unrefuted_cemetery_node',
          'warning',
          `Refuted hypothesis node "${id}" should have an incoming edge with role: "refutes" indicating what disproved it`,
          { id, path: `/nodes/${id}` },
          {},
          ['Add an edge with role: "refutes" from the calculation/observable that disproved this hypothesis']
        );
      }
    }
  }

  // 5. Main Path Verification
  if (data.meta?.main_path && Array.isArray(data.meta.main_path)) {
    for (const nodeId of data.meta.main_path) {
      if (!nodeMap.has(nodeId)) {
        addDiagnostic(
          'gate/broken_main_path',
          'error',
          `meta.main_path references non-existent node "${nodeId}"`,
          { path: '/meta/main_path' },
          { missingNode: nodeId },
          [`Remove or fix node id "${nodeId}" in main_path`]
        );
      }
    }
  }

  const errors = diagnostics.filter(d => d.severity === 'error');
  const warnings = diagnostics.filter(d => d.severity === 'warning');

  return {
    ok: errors.length === 0,
    summary: {
      errors: errors.length,
      warnings: warnings.length,
      nodeCount: nodeMap.size,
      edgeCount: edges.length,
    },
    diagnostics,
  };
}
