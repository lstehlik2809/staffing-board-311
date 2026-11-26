// One place for every number that defines the model, the rules and the
// illustrative staffing assumptions. The pipeline and the browser both read it,
// so a published statement and the chart beside it use identical settings.

export const MODEL_VERSION = 'level-calendar-mixture/1.0';

// Predictive quantiles kept in the forecast ledger.
// lo3 / hi3 are the 3-sigma-equivalent control limits (99.73% of ordinary days).
export const PROBS = [0.00135, 0.05, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99865];
export const Q = { lo3: 0, q05: 1, q25: 2, q50: 3, q75: 4, q90: 5, q95: 6, hi3: 7 };

export const DEFAULTS = {
  trainDays: 728,          // two years of daily totals for the headline model
  topicTrainDays: 364,     // one year for each call topic
  horizon: 14,             // days forecast ahead
  displayPastDays: 42,     // six weeks of history on the main chart
  outlookDays: 7,          // staffing outlook
  topicCount: 24,
  topicCandidates: 70,     // highest-volume topics considered ...
  topicMinDaily: 20,       // ... kept if even a quiet day (5th percentile) has this many calls
  topicBlocks: 10,         // 7-day blocks shown per topic
  coverageDays: 180,       // length of the out-of-sample track record

  // Sampler used for the headline model, in the pipeline and in the browser.
  sampler: { chains: 4, warmup: 500, draws: 2000, seed: 311 },
  // Lighter sampler for the many as-of fits behind the control limits.
  ledgerSampler: { chains: 2, warmup: 400, draws: 1000, seed: 311 },

  // Exceptional days are modelled with a variance kappa^2 times the ordinary one.
  kappa: 10,
  priors: {
    betaSd: 1,                 // calendar effects, log scale: Normal(0, 1)
    phiSd: 0.5,                // one-day carry-over: Normal(0, 0.5), kept inside (-0.9, 0.9)
    sigA: 2, sigB: 0.005,      // ordinary day-to-day variance, per day class: Inv-Gamma(2, 0.005)
    // Daily drift of the level. Informative on purpose: centred on a drift of
    // about 1% a day, the size seen in 2023-24 history before the training
    // window, so that short-lived swings are not mistaken for a moving level.
    tauA: 50, tauB: 0.005,
    // Share of exceptional days. Informative on purpose (about 5% +/- 0.7%):
    // this prior is what defines an "ordinary" day.
    piA: 50, piB: 950,
  },

  // A recorded count below this share of its usual level is treated as an
  // incomplete record (feed gap), not as demand.
  incompleteShare: 0.25,

  // Illustrative contact-centre assumptions. They are NOT NYC 311's figures.
  staffing: {
    ahtSec: 300,        // average handle time
    slTarget: 0.8,      // share of calls answered ...
    answerSec: 30,      // ... within this many seconds
    shrinkage: 0.3,     // paid time not on the phones (breaks, training, absence)
    lockDays: 14,       // roster is fixed this many days ahead
    rosterProb: 0.9,    // ... at this percentile of the forecast made then
  },

  // Illustrative decision rules; a real team would set these with the owner.
  rules: {
    shortfallProb: 0.25,   // act when P(required > rostered) reaches this
    surplusShare: 0.85,    // "surplus" = requirement below 85% of the roster ...
    surplusProb: 0.75,     // ... with at least this probability
  },
};

// Sensitivity option: looser priors on calendar effects, noise and carry-over.
// The drift and exceptional-day priors stay as they are because they define
// what the control limits mean.
export const WIDER_PRIORS = {
  betaSd: 2.5, phiSd: 1, sigA: 2, sigB: 0.05, tauA: 50, tauB: 0.005, piA: 50, piB: 950,
};
