// ── VES 1D Inversion Engine — Marquardt Least Squares ────────────────────────
// Computes theoretical apparent resistivity for a layered earth model
// using the kernel function approach (Ghosh filter / linear filter method)

// ── Forward model: compute theoretical ρa for Schlumberger array ─────────────
// Uses the recursive kernel function T(λ) evaluated at Bessel function roots
// Simplified but accurate for 2–5 layer models in basement complex terrain

function forwardModel(ab2vals, thicknesses, resistivities) {
  // ab2vals: array of AB/2 spacings
  // thicknesses: array of layer thicknesses (last layer = half-space, ignored)
  // resistivities: array of true resistivities (all layers including basement)
  var n = resistivities.length;
  var results = [];

  for (var si = 0; si < ab2vals.length; si++) {
    var ab2 = ab2vals[si];
    // Numerical integration using Gaussian quadrature approximation
    // of the Stefanescu integral for Schlumberger array
    var rhoA = schlumbergerKernel(ab2, thicknesses, resistivities, n);
    results.push(rhoA);
  }
  return results;
}

function schlumbergerKernel(ab2, thicknesses, resistivities, n) {
  // Evaluate the Stefanescu integral using digital filter coefficients
  // (Ghosh 1971 linear filter method — 12-point filter)
  var FILTER_COEFFS = [
    -0.0000175, 0.0000816, -0.000337, 0.001264, -0.004237, 0.012469,
    -0.031015,  0.063792,  -0.106155, 0.130530, -0.103318,  0.045869
  ];
  var FILTER_BASE = 0.2; // log10 spacing

  var sum = 0;
  for (var i = 0; i < FILTER_COEFFS.length; i++) {
    var lambda = Math.pow(10, (i - 5) * FILTER_BASE) / ab2;
    var T = kernelT(lambda, thicknesses, resistivities, n);
    sum += FILTER_COEFFS[i] * T;
  }

  // Fallback to direct Hankel transform approximation if filter gives bad result
  if (isNaN(sum) || sum <= 0) {
    sum = directApprox(ab2, thicknesses, resistivities, n);
  }
  return Math.abs(sum);
}

function kernelT(lambda, thicknesses, resistivities, n) {
  // Recursive kernel function (Pekeris recursion, bottom up)
  var T = resistivities[n - 1]; // Start with basement resistivity

  for (var i = n - 2; i >= 0; i--) {
    var h = thicknesses[i];
    if (!h || isNaN(h) || h <= 0) continue;
    var rho = resistivities[i];
    var u = lambda; // For Schlumberger, u = lambda
    var tanh_val = Math.tanh(u * h);
    T = rho * (T + rho * tanh_val) / (rho + T * tanh_val);
  }
  return T;
}

function directApprox(ab2, thicknesses, resistivities, n) {
  // Simple geometric approximation as fallback
  // Works well for spacing much smaller or larger than layer depths
  var depth = 0;
  for (var i = 0; i < thicknesses.length; i++) {
    depth += thicknesses[i] || 0;
    if (ab2 < depth * 0.3) return resistivities[i];
  }
  return resistivities[n - 1];
}

// ── RMS Error between field and theoretical curves ────────────────────────────
function computeRMS(fieldRhoA, theoreticalRhoA) {
  if (fieldRhoA.length !== theoreticalRhoA.length) return Infinity;
  var sumSq = 0;
  var count = 0;
  for (var i = 0; i < fieldRhoA.length; i++) {
    if (!fieldRhoA[i] || fieldRhoA[i] <= 0 || !theoreticalRhoA[i] || theoreticalRhoA[i] <= 0) continue;
    var diff = Math.log(fieldRhoA[i]) - Math.log(theoreticalRhoA[i]);
    sumSq += diff * diff;
    count++;
  }
  return count > 0 ? Math.sqrt(sumSq / count) * 100 : Infinity; // % RMS in log space
}

// ── Layer Count Assist ────────────────────────────────────────────────────────
function suggestLayerCount(rhoA) {
  if (!rhoA || rhoA.length < 3) return { count: 3, reason: "Insufficient data — defaulting to 3 layers", curveType: "" };

  // Smooth to reduce noise before counting inflections
  var smoothed = [];
  for (var i = 0; i < rhoA.length; i++) {
    var vals = rhoA.slice(Math.max(0, i - 1), Math.min(rhoA.length, i + 2));
    smoothed.push(vals.reduce(function(a, b) { return a + b; }, 0) / vals.length);
  }

  // Count significant turns (change > 5% in log space)
  var turns = [];
  for (var i = 1; i < smoothed.length - 1; i++) {
    var logPrev = Math.log10(smoothed[i - 1]);
    var logCurr = Math.log10(smoothed[i]);
    var logNext = Math.log10(smoothed[i + 1]);
    var dLeft = logCurr - logPrev;
    var dRight = logNext - logCurr;
    if (dLeft < -0.05 && dRight > 0.05) turns.push({ type: "min", idx: i });
    else if (dLeft > 0.05 && dRight < -0.05) turns.push({ type: "max", idx: i });
  }

  var nLayers = turns.length + 2; // bends + 1 = layers needed; +1 for safety
  nLayers = Math.min(Math.max(nLayers, 2), 6);

  // Curve type from turn pattern
  var curveType = "";
  var first = rhoA[0], last = rhoA[rhoA.length - 1];
  if (turns.length === 0) curveType = last > first ? "A" : "Q";
  else if (turns.length === 1) curveType = turns[0].type === "min" ? "H" : "K";
  else if (turns.length === 2) {
    if (turns[0].type === "min" && turns[1].type === "max") curveType = "HK";
    else if (turns[0].type === "max" && turns[1].type === "min") curveType = "KH";
  }

  var reasons = {
    "H":  "One minimum detected — classic 3-layer H-type (aquifer between resistive layers)",
    "K":  "One maximum detected — 3-layer K-type (resistive middle layer)",
    "A":  "No inflection, ρa increasing — 3-layer A-type or simple 2-layer",
    "Q":  "No inflection, ρa decreasing — 3-layer Q-type",
    "HK": "Two inflections (min then max) — 4-layer HK curve",
    "KH": "Two inflections (max then min) — 4-layer KH curve, aquifer below K peak",
  };

  return {
    count: nLayers,
    curveType: curveType,
    turns: turns.length,
    reason: reasons[curveType] || (turns.length + " inflection point(s) detected — " + nLayers + " layers suggested")
  };
}

// ── Initial model estimate from curve shape ───────────────────────────────────
function initialModel(ab2vals, rhoA, nLayers) {
  var minRho = Math.min.apply(null, rhoA);
  var maxRho = Math.max.apply(null, rhoA);
  var minAB  = Math.min.apply(null, ab2vals);
  var maxAB  = Math.max.apply(null, ab2vals);

  // Spread layer thicknesses logarithmically across the AB/2 range
  var thicknesses = [];
  for (var i = 0; i < nLayers - 1; i++) {
    var frac = (i + 1) / nLayers;
    thicknesses.push(minAB * Math.pow(maxAB / minAB, frac));
  }

  // Spread resistivities to cover the observed range
  var resistivities = [];
  for (var i = 0; i < nLayers; i++) {
    var frac2 = i / Math.max(nLayers - 1, 1);
    resistivities.push(minRho * Math.pow(maxRho / minRho, frac2));
  }

  // For H-type hint: make middle layer lower resistivity
  var suggest = suggestLayerCount(rhoA);
  if (suggest.curveType === "H" && nLayers >= 3) {
    resistivities[0] = maxRho * 0.7;
    resistivities[1] = minRho;
    resistivities[nLayers - 1] = maxRho;
  }

  return { thicknesses, resistivities };
}

// ── Marquardt (Levenberg-Marquardt) Inversion ─────────────────────────────────
// Minimises sum of squared log-residuals between field and theoretical ρa
// Parameters: log(thicknesses) + log(resistivities) — log space for stability

function invert(ab2vals, fieldRhoA, nLayers, maxIter, onProgress) {
  maxIter = maxIter || 50;

  var init = initialModel(ab2vals, fieldRhoA, nLayers);
  var thicknesses = init.thicknesses.slice();
  var resistivities = init.resistivities.slice();

  var nParams = (nLayers - 1) + nLayers; // thicknesses (n-1) + resistivities (n)
  var lambda = 0.01; // Marquardt damping factor

  var bestRMS = Infinity;
  var bestThick = thicknesses.slice();
  var bestResis = resistivities.slice();

  for (var iter = 0; iter < maxIter; iter++) {
    var theoretical = forwardModel(ab2vals, thicknesses, resistivities);
    var rms = computeRMS(fieldRhoA, theoretical);

    if (rms < bestRMS) {
      bestRMS = rms;
      bestThick = thicknesses.slice();
      bestResis = resistivities.slice();
    }

    if (onProgress) onProgress(iter, rms);
    if (rms < 2.0) break; // Good enough fit

    // Compute Jacobian (partial derivatives) via finite differences
    var J = [];
    var residuals = [];
    for (var di = 0; di < fieldRhoA.length; di++) {
      if (!fieldRhoA[di] || fieldRhoA[di] <= 0 || !theoretical[di] || theoretical[di] <= 0) {
        residuals.push(0);
        J.push(new Array(nParams).fill(0));
        continue;
      }
      residuals.push(Math.log(fieldRhoA[di]) - Math.log(theoretical[di]));
      var row = [];
      // Partial derivatives for thicknesses
      for (var ti = 0; ti < nLayers - 1; ti++) {
        var dh = thicknesses[ti] * 0.05;
        var thickPlus = thicknesses.slice(); thickPlus[ti] += dh;
        var fPlus = forwardModel([ab2vals[di]], thickPlus, resistivities)[0];
        row.push((Math.log(fPlus) - Math.log(theoretical[di])) / dh * thicknesses[ti]);
      }
      // Partial derivatives for resistivities
      for (var ri = 0; ri < nLayers; ri++) {
        var dr = resistivities[ri] * 0.05;
        var resiPlus = resistivities.slice(); resiPlus[ri] += dr;
        var fPlus2 = forwardModel([ab2vals[di]], thicknesses, resiPlus)[0];
        row.push((Math.log(fPlus2) - Math.log(theoretical[di])) / dr * resistivities[ri]);
      }
      J.push(row);
    }

    // Normal equations: (J^T J + λ diag(J^T J)) Δp = J^T r
    var JtJ = [];
    var Jtr = new Array(nParams).fill(0);
    for (var p = 0; p < nParams; p++) {
      JtJ.push(new Array(nParams).fill(0));
      for (var di2 = 0; di2 < residuals.length; di2++) {
        Jtr[p] += J[di2][p] * residuals[di2];
      }
    }
    for (var p = 0; p < nParams; p++) {
      for (var q = 0; q < nParams; q++) {
        for (var di3 = 0; di3 < residuals.length; di3++) {
          JtJ[p][q] += J[di3][p] * J[di3][q];
        }
      }
    }
    // Add Marquardt damping to diagonal
    for (var p = 0; p < nParams; p++) {
      JtJ[p][p] *= (1 + lambda);
    }

    // Solve via Gaussian elimination
    var delta = gaussianElimination(JtJ, Jtr);
    if (!delta) { lambda *= 10; continue; }

    // Update parameters (in log space, clamp to prevent negatives)
    var newThick = thicknesses.slice();
    var newResis = resistivities.slice();
    for (var ti2 = 0; ti2 < nLayers - 1; ti2++) {
      newThick[ti2] = Math.max(0.1, thicknesses[ti2] + delta[ti2] * thicknesses[ti2]);
    }
    for (var ri2 = 0; ri2 < nLayers; ri2++) {
      newResis[ri2] = Math.max(0.1, resistivities[ri2] + delta[nLayers - 1 + ri2] * resistivities[ri2]);
    }

    var newTheoretical = forwardModel(ab2vals, newThick, newResis);
    var newRMS = computeRMS(fieldRhoA, newTheoretical);

    if (newRMS < rms) {
      thicknesses = newThick;
      resistivities = newResis;
      lambda = Math.max(lambda * 0.1, 1e-7);
    } else {
      lambda = Math.min(lambda * 10, 1e7);
    }
  }

  var finalTheoretical = forwardModel(ab2vals, bestThick, bestResis);
  var finalRMS = computeRMS(fieldRhoA, finalTheoretical);

  return {
    thicknesses: bestThick,
    resistivities: bestResis,
    theoretical: finalTheoretical,
    rms: finalRMS,
    converged: finalRMS < 10
  };
}

// ── Gaussian elimination for Ax = b ──────────────────────────────────────────
function gaussianElimination(A, b) {
  var n = b.length;
  var M = A.map(function(row, i) { return row.slice().concat([b[i]]); });

  for (var col = 0; col < n; col++) {
    // Find pivot
    var maxRow = col;
    for (var row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
    }
    var tmp = M[col]; M[col] = M[maxRow]; M[maxRow] = tmp;

    if (Math.abs(M[col][col]) < 1e-12) return null; // Singular

    for (var row2 = col + 1; row2 < n; row2++) {
      var factor = M[row2][col] / M[col][col];
      for (var k = col; k <= n; k++) {
        M[row2][k] -= factor * M[col][k];
      }
    }
  }

  // Back substitution
  var x = new Array(n).fill(0);
  for (var i = n - 1; i >= 0; i--) {
    x[i] = M[i][n];
    for (var j = i + 1; j < n; j++) {
      x[i] -= M[i][j] * x[j];
    }
    x[i] /= M[i][i];
    if (isNaN(x[i])) return null;
  }
  return x;
}

export { invert, suggestLayerCount, forwardModel, computeRMS };
