//+------------------------------------------------------------------+
//| TitanPortfolioEA.mq5  v1.22                                      |
//| Staged-risk portfolio EA for Titan FX MT5 (JPY account, Blade)   |
//|   1) GOTOBI   : USDJPY short at the 09:55 JST Tokyo fix on       |
//|                 Japanese gotobi days, flat at 15:00 JST (LIVE)   |
//|   2) MEANREV  : D1 Bollinger re-entry on 5 majors (DEMO ONLY -   |
//|                 failed 1976-2004 and 2020-2026 checks)           |
//|   3) CARRY    : D1 carry with trend/vol protection (IDLE until a |
//|                 pair's previous-year rate differential >= 4%)    |
//| Rules mirror fx_autotrader/fxlab (Python backtest); see          |
//| docs/EA_MANUAL.md.  Every position carries a server-side stop    |
//| from the moment it is opened.  No martingale/grid/averaging.     |
//+------------------------------------------------------------------+
#property copyright "fx_autotrader"
#property version   "1.22"
#property description "Gotobi (+ optional D1 mean reversion / carry) with staged risk for Titan FX MT5 (JPY, hedging account)."

#include <Trade\Trade.mqh>

//==================================================================== inputs
input group "=== General ==="
input string InpSymbolSuffix    = "";        // e.g. "-m" on Micro accounts; "" on Standard/Blade
input long   InpMagicBase       = 26092600;  // magics: base+1 gotobi, base+2 meanrev, base+3 carry
input int    InpServerDST       = 0;         // clock rule: 0 = NY+7h (US DST, Titan FX), 1 = EU DST, 2 = fixed GMT+2, 3 = fixed GMT+3
input bool   InpLogCsv          = true;

input group "=== Books (risk per trade in % of balance) ==="
input bool   InpGotobiOn        = true;
input double InpGotobiRiskPct   = 0.5;       // stage 1: 0.5 ; stage 2: 1.0 ; ceiling while gotobi trades alone: 1.25
input bool   InpMeanRevOn       = false;     // demo account only
input double InpMeanRevRiskPct  = 0.25;
input bool   InpCarryOn         = false;     // enable only when a pair qualifies AND balance >= 1,000,000 JPY
input double InpCarryRiskPct    = 0.5;
input double InpCarryBookCapPct = 2.0;       // max initial risk of all open carry positions (% of balance)

input group "=== Account risk ==="
input string InpStages          = "0:1.0";   // balanceJPY:multiplier;...  keep "0:1.0" and raise risk by hand (docs/STAGED_PLAN.md)
input double InpMaxOpenRiskPct  = 8.0;       // sum of initial risk of open positions (% of balance)
input int    InpMaxPositions    = 10;
input double InpThrottleDDPct   = 4.0;       // balance DD from peak -> all risk x InpThrottleMult (8x per-trade risk)
input double InpThrottleMult    = 0.5;
input double InpHaltDDPct       = 6.0;       // equity DD from peak -> close all and stop (12x per-trade risk)
input double InpDailyLossPct    = 3.0;       // equity loss within a server day -> no new entries that day
input double InpMarginUsePct    = 50.0;
input double InpTargetEquity    = 0.0;       // >0: when equity reaches this (JPY), close all and stop (10x challenge: 1000000)

input group "=== Execution ==="
input int    InpDeviationPts    = 20;
input double InpMaxSpreadPips   = 2.0;       // D1 books: skip entries above this spread

input group "=== GOTOBI book ==="
input string InpGotobiSymbol    = "USDJPY";
input int    InpGotobiEntrySec  = 35700;     // 09:55:00 JST (seconds after midnight)
input int    InpGotobiWindowSec = 60;        // entry window [09:55:00, 09:56:00); missed -> skip the day
input int    InpGotobiExitSec   = 54000;     // 15:00:00 JST
input double InpGotobiStopAtr   = 0.5;       // x D1 ATR(14) of the last closed D1 bar
input double InpGotobiMaxSpread = 0.7;       // pips; the OOS edge is ~2 pips per trade
input bool   InpGotobiSkipDec25 = true;      // the backtest has no Dec-25 trades 2012-2019
input string InpJpExtraHolidays = "";        // extra Japanese non-business days "YYYY.MM.DD;YYYY.MM.DD"

input group "=== MEANREV book (D1, demo only) ==="
input string InpMrSymbols       = "USDJPY,EURUSD,GBPUSD,AUDUSD,USDCAD";
input int    InpMrBbN           = 20;
input double InpMrBbK           = 1.5;
input int    InpMrAdxN          = 14;
input double InpMrAdxMax        = 25.0;
input int    InpMrAtrN          = 14;
input int    InpMrVolN          = 100;
input double InpMrVolMax        = 1.0;
input int    InpMrEmaN          = 200;
input double InpMrFlatK         = 3.0;
input int    InpMrExitN         = 20;
input double InpMrStopAtr       = 2.5;
input int    InpMrMaxHold       = 10;

input group "=== CARRY book (D1) ==="
input string InpCarrySymbols    = "USDJPY,EURUSD,GBPUSD,AUDUSD,USDCAD,EURJPY,GBPJPY,AUDJPY,CADJPY,EURGBP,EURAUD,GBPAUD,EURCAD,AUDCAD,GBPCAD";
// COMPLETED calendar years only: daily average over Jan 1..Dec 31, 2 decimals.  USD=EFFR, EUR=ECB deposit rate,
// JPY=BoJ policy rate, GBP=Bank Rate, AUD=RBA cash rate, CAD=BoC overnight target.  Add the new row every January.
input string InpRates           = "2024:USD=5.14,EUR=3.73,JPY=0.10,GBP=5.11,AUD=4.35,CAD=4.55;2025:USD=4.21,EUR=2.26,JPY=0.49,GBP=4.25,AUD=3.88,CAD=2.70";
input double InpCarryMinDiff    = 4.0;
input int    InpCarryEmaN       = 50;
input int    InpCarryVolFast    = 20;
input int    InpCarryVolSlow    = 250;
input double InpCarryVolEntry   = 1.0;
input double InpCarryVolExit    = 1.5;
input int    InpCarryAtrN       = 20;
input double InpCarryStopAtr    = 2.0;
input double InpCarryTrailAtr   = 3.0;

//==================================================================== types / globals
struct D1State
  {
   string   sym;
   datetime last_bar;
   string   gv;        // persists last_bar across restarts
   datetime retry_at;  // earliest time a failed decision may be re-run
  };

CTrade    g_trade;
D1State   g_mr[];
D1State   g_carry[];
string    g_gotobi_sym = "";
double    g_stage_bal[];
double    g_stage_mult[];
string    g_prefix = "";                     // "TPEA_<login>_<magic>_" (empty until logged in)
string    g_gv_balpeak, g_gv_eqpeak, g_gv_halt, g_gv_day, g_gv_daybal, g_gv_gotobi_day, g_gv_ratewarn, g_gv_flowtk;
string    g_gv_lock = "";
bool      g_ready = false;
int       g_csv = INVALID_HANDLE;
datetime  g_extra_hol[];
bool      g_tester = false;
datetime  g_mech_day = 0;
double    g_mech_mid0955 = 0.0;
bool      g_mech_done = false;
datetime  g_clock_warn_day = 0;
string    g_last_skip = "";
datetime  g_last_skip_t = 0;
string    g_err_key[];                       // per-key de-duplication of ERR_* lines
datetime  g_err_t[];
datetime  g_last_push = 0;
datetime  g_halt_retry = 0, g_gv_flushed = 0, g_flow_unsync = 0, g_flow_checked = 0;
bool      g_flow_warned = false;
double    g_rec_bal = -1.0, g_rec_cred = -1.0;  // balance / credit at the last successful reconcile
long      g_clock_skew = 0;                  // TimeTradeServer() (PC clock) minus server quote time
datetime  g_skew_tc = 0, g_skew_warn_day = 0;
uint      g_send_rc = 0;                     // retcode of the last request OpenMarket actually sent (0 = none sent)

long MagicGotobi()  { return InpMagicBase + 1; }
long MagicMeanRev() { return InpMagicBase + 2; }
long MagicCarry()   { return InpMagicBase + 3; }

//==================================================================== logging / utils
datetime Now() { return g_tester ? TimeCurrent() : (datetime)((long)TimeTradeServer() - g_clock_skew); }

// measure the PC clock error against server quote times (called every timer event)
void UpdateClockSkew()
  {
   if(g_tester) return;
   datetime tc = TimeCurrent();
   if(tc == g_skew_tc) return;                       // no new quote second since the last timer event
   bool first = (g_skew_tc == 0);
   g_skew_tc = tc;
   if(first) return;                                 // the first reading may be an old quote
   long sk = (long)TimeTradeServer() - (long)tc;     // clock error + 0..1 s of quote latency
   if(sk > -3600 && sk < 3600) g_clock_skew = sk > 2 || sk < -2 ? sk : 0;
   datetime d = DayStart(tc);
   if((sk > 30 || sk < -30) && g_skew_warn_day != d)
     {
      g_skew_warn_day = d;
      Print(StringFormat("CLOCK: PC clock differs from server quotes by %I64d s - corrected (sync the VPS clock with NTP)", sk));
     }
  }

void Log(const string what, const string sym, const string detail)
  {
   if(what == "SKIP")
     {
      string key = sym + "|" + detail;
      if(key == g_last_skip && Now() - g_last_skip_t < 300) return;
      g_last_skip = key; g_last_skip_t = Now();
     }
   else if(StringFind(what, "ERR_") == 0)
     {
      string key = what + "|" + sym + "|" + detail;
      datetime now = Now();
      int n = 0, k = -1;
      for(int i = 0; i < ArraySize(g_err_key); i++)                  // keep entries younger than 5 min
         if(now - g_err_t[i] < 300)
           {
            g_err_key[n] = g_err_key[i]; g_err_t[n] = g_err_t[i];
            if(g_err_key[n] == key) k = n;
            n++;
           }
      ArrayResize(g_err_key, n); ArrayResize(g_err_t, n);
      if(k >= 0) return;                                             // same failure logged < 5 min ago
      ArrayResize(g_err_key, n + 1); ArrayResize(g_err_t, n + 1);
      g_err_key[n] = key; g_err_t[n] = now;
      if(!g_tester && what == "ERR_CLOSE" && TimeLocal() - g_last_push >= 10)   // MT5 allows <= 10 pushes/min
        { g_last_push = TimeLocal(); SendNotification("TitanPortfolioEA " + what + " " + sym + " " + detail); }
     }
   string line = StringFormat("%s,%s,%s,%s", TimeToString(Now(), TIME_DATE | TIME_SECONDS), what, sym, detail);
   Print(line);
   if(InpLogCsv && g_csv != INVALID_HANDLE) { FileWrite(g_csv, line); FileFlush(g_csv); }
  }

void Notify(const string msg)
  {
   Log("NOTIFY", "", msg);
   if(!g_tester) { Alert(msg); g_last_push = TimeLocal(); SendNotification(msg); }
  }

double GvGet(const string name, const double def)
  {
   if(GlobalVariableCheck(name)) return GlobalVariableGet(name);
   GlobalVariableSet(name, def);
   return def;
  }

void GvFlush() { if(!g_tester) GlobalVariablesFlush(); }

double PipSize(const string sym)
  {
   string base = StringSubstr(sym, 0, 3), quote = StringSubstr(sym, 3, 3);
   if(base == "XAU" || base == "XAG") return 0.01;
   return quote == "JPY" ? 0.01 : 0.0001;
  }

double SpreadPips(const string sym)
  {
   return (SymbolInfoDouble(sym, SYMBOL_ASK) - SymbolInfoDouble(sym, SYMBOL_BID)) / PipSize(sym);
  }

datetime MakeDate(const int y, const int m, const int d)
  {
   MqlDateTime t; ZeroMemory(t);
   t.year = y; t.mon = m; t.day = d;
   return StructToTime(t);
  }

int Dow(const datetime t) { MqlDateTime s; TimeToStruct(t, s); return s.day_of_week; }   // 0=Sun..6=Sat
datetime DayStart(const datetime t) { return t - (t % 86400); }

int DaysInMonth(const int y, const int m)
  {
   int dm[12] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
   if(m == 2 && ((y % 4 == 0 && y % 100 != 0) || y % 400 == 0)) return 29;
   return dm[m - 1];
  }

//==================================================================== clocks
datetime NthSunday(const int y, const int m, const int n)
  {
   datetime first = MakeDate(y, m, 1);
   int add = (7 - Dow(first)) % 7;
   return first + (add + 7 * (n - 1)) * 86400;
  }

datetime LastSunday(const int y, const int m)
  {
   datetime last = MakeDate(y, m, DaysInMonth(y, m));
   return last - Dow(last) * 86400;
  }

// server clock offset from UTC by rule (2 or 3).  The switch is on a Sunday while the
// market is closed, so a date-based test is exact for every trading minute.
int RuleOffset(const datetime server)
  {
   MqlDateTime s; TimeToStruct(server, s);
   datetime d = DayStart(server);
   bool summer = false;
   if(InpServerDST == 0)
     {
      if(s.year >= 2007) summer = d >= NthSunday(s.year, 3, 2) && d < NthSunday(s.year, 11, 1);
      else               summer = d >= NthSunday(s.year, 4, 1) && d < LastSunday(s.year, 10);
     }
   else if(InpServerDST == 1) summer = d >= LastSunday(s.year, 3) && d < LastSunday(s.year, 10);
   else if(InpServerDST == 3) summer = true;
   return summer ? 3 : 2;
  }

int LiveOffset()
  {
   if(g_tester) return 0;
   long diff = (long)TimeTradeServer() - (long)TimeGMT();
   int h = (int)MathRound(diff / 3600.0);
   return (h == 2 || h == 3) ? h : 0;
  }

// offset used for JST; `ok` is false when live and rule disagree (gotobi skips that day)
int ServerOffset(const datetime server, bool &ok)
  {
   int rule = RuleOffset(server);
   ok = true;
   if(g_tester) return rule;
   int live = LiveOffset();
   if(live == 0 || live != rule)
     {
      ok = false;
      datetime d = DayStart(server);
      if(g_clock_warn_day != d)
        {
         g_clock_warn_day = d;
         Log("CLOCK", "", StringFormat("live offset GMT+%d differs from rule GMT+%d (InpServerDST=%d): gotobi skipped today",
             live, rule, InpServerDST));
        }
      return live != 0 ? live : rule;
     }
   return rule;
  }

datetime ServerToJst(const datetime server, bool &ok) { return server + (9 - ServerOffset(server, ok)) * 3600; }

//==================================================================== Japanese calendar (port of fxlab/strategies/seasonality.py)
datetime NthMonday(const int y, const int m, const int n)
  {
   datetime first = MakeDate(y, m, 1);
   int add = (8 - Dow(first)) % 7;
   return first + (add + 7 * (n - 1)) * 86400;
  }

bool InList(const datetime &arr[], const datetime d)
  {
   for(int i = 0; i < ArraySize(arr); i++) if(arr[i] == d) return true;
   return false;
  }

void AddDate(datetime &arr[], const datetime d)
  {
   if(InList(arr, d)) return;
   int k = ArraySize(arr);
   ArrayResize(arr, k + 1);
   arr[k] = d;
  }

// Japanese national holidays of year y (verified 2004-2030 against python-holidays / jpholiday)
void JpHolidays(const int y, datetime &h[])
  {
   ArrayResize(h, 0);
   AddDate(h, MakeDate(y, 1, 1));
   AddDate(h, NthMonday(y, 1, 2));
   AddDate(h, MakeDate(y, 2, 11));
   AddDate(h, MakeDate(y, 3, (int)MathFloor(20.8431 + 0.242194 * (y - 1980) - (int)((y - 1980) / 4))));
   AddDate(h, MakeDate(y, 4, 29));
   AddDate(h, MakeDate(y, 5, 3));
   AddDate(h, MakeDate(y, 5, 4));
   AddDate(h, MakeDate(y, 5, 5));
   AddDate(h, MakeDate(y, 9, (int)MathFloor(23.2488 + 0.242194 * (y - 1980) - (int)((y - 1980) / 4))));
   AddDate(h, MakeDate(y, 11, 3));
   AddDate(h, MakeDate(y, 11, 23));
   if(y <= 2018) AddDate(h, MakeDate(y, 12, 23));
   if(y >= 2020) AddDate(h, MakeDate(y, 2, 23));
   if(y == 2020) { AddDate(h, MakeDate(2020, 7, 23)); AddDate(h, MakeDate(2020, 7, 24)); AddDate(h, MakeDate(2020, 8, 10)); }
   else if(y == 2021) { AddDate(h, MakeDate(2021, 7, 22)); AddDate(h, MakeDate(2021, 7, 23)); AddDate(h, MakeDate(2021, 8, 8)); }
   else
     {
      AddDate(h, NthMonday(y, 7, 3));
      AddDate(h, NthMonday(y, 10, 2));
      if(y >= 2016) AddDate(h, MakeDate(y, 8, 11));
     }
   AddDate(h, NthMonday(y, 9, 3));
   if(y == 2019) { AddDate(h, MakeDate(2019, 4, 30)); AddDate(h, MakeDate(2019, 5, 1)); AddDate(h, MakeDate(2019, 5, 2)); AddDate(h, MakeDate(2019, 10, 22)); }
   int n0 = ArraySize(h);
   datetime base[]; ArrayResize(base, n0);
   for(int i = 0; i < n0; i++) base[i] = h[i];
   for(int i = 0; i < n0; i++)                       // citizens' holiday
     {
      datetime mid = base[i] + 86400;
      if(!InList(h, mid) && InList(h, mid + 86400) && Dow(mid) != 0) AddDate(h, mid);
     }
   int n1 = ArraySize(h);
   datetime snap[]; ArrayResize(snap, n1);
   for(int i = 0; i < n1; i++) snap[i] = h[i];
   ArraySort(snap);
   for(int i = 0; i < n1; i++)                       // substitute holiday
     {
      if(Dow(snap[i]) == 0)
        {
         datetime s = snap[i] + 86400;
         while(InList(h, s)) s += 86400;
         AddDate(h, s);
        }
     }
  }

bool JpBusinessDay(const datetime day)
  {
   int dw = Dow(day);
   if(dw == 0 || dw == 6) return false;
   MqlDateTime s; TimeToStruct(day, s);
   if((s.mon == 12 && s.day == 31) || (s.mon == 1 && s.day <= 3)) return false;
   if(InList(g_extra_hol, day)) return false;
   datetime h[];
   JpHolidays(s.year, h);
   return !InList(h, day);
  }

bool IsGotobi(const datetime day)
  {
   MqlDateTime s; TimeToStruct(day, s);
   for(int k = 0; k < 2; k++)                        // targets of this month and the next
     {
      int y = s.year, m = s.mon + k;
      if(m == 13) { m = 1; y++; }
      int targets[6] = {5, 10, 15, 20, 25, 0};
      targets[5] = DaysInMonth(y, m);
      for(int i = 0; i < 6; i++)
        {
         datetime d = MakeDate(y, m, targets[i]);
         while(!JpBusinessDay(d)) d -= 86400;
         if(d == day) return true;
        }
     }
   return false;
  }

//==================================================================== indicators (series order: index 1 = last closed bar)
double TrueRange(const MqlRates &r[], const int i)
  {
   double pc = r[i + 1].close;
   return MathMax(r[i].high - r[i].low, MathMax(MathAbs(r[i].high - pc), MathAbs(r[i].low - pc)));
  }

double AtrSma(const MqlRates &r[], const int shift, const int n)
  {
   double s = 0.0;
   for(int i = shift; i < shift + n; i++) s += TrueRange(r, i);
   return s / n;
  }

double Sma(const MqlRates &r[], const int shift, const int n)
  {
   double s = 0.0;
   for(int i = shift; i < shift + n; i++) s += r[i].close;
   return s / n;
  }

double StdPop(const MqlRates &r[], const int shift, const int n)
  {
   double m = Sma(r, shift, n), v = 0.0;
   for(int i = shift; i < shift + n; i++) v += (r[i].close - m) * (r[i].close - m);
   return MathSqrt(v / n);
  }

double Ema(const MqlRates &r[], const int shift, const int n, const int total)
  {
   double a = 2.0 / (n + 1.0);
   double e = r[total - 1].close;
   for(int i = total - 2; i >= shift; i--) e = a * r[i].close + (1.0 - a) * e;
   return e;
  }

double AdxWilder(const MqlRates &r[], const int shift, const int n, const int total)
  {
   double tr_s = 0, p_s = 0, n_s = 0, adx = 0, dx_sum = 0;
   int cnt = 0, dx_cnt = 0;
   bool ready = false;
   for(int i = total - 2; i >= shift; i--)
     {
      double up = r[i].high - r[i + 1].high;
      double dn = r[i + 1].low - r[i].low;
      double pdm = (up > dn && up > 0) ? up : 0.0;
      double ndm = (dn > up && dn > 0) ? dn : 0.0;
      double tr = TrueRange(r, i);
      cnt++;
      if(cnt <= n)
        {
         tr_s += tr; p_s += pdm; n_s += ndm;
         if(cnt < n) continue;
         tr_s /= n; p_s /= n; n_s /= n;
        }
      else
        {
         tr_s = (tr_s * (n - 1) + tr) / n;
         p_s = (p_s * (n - 1) + pdm) / n;
         n_s = (n_s * (n - 1) + ndm) / n;
        }
      double pdi = tr_s > 0 ? 100.0 * p_s / tr_s : 0.0;
      double ndi = tr_s > 0 ? 100.0 * n_s / tr_s : 0.0;
      double dx = (pdi + ndi) > 0 ? 100.0 * MathAbs(pdi - ndi) / (pdi + ndi) : 0.0;
      if(!ready) { dx_sum += dx; dx_cnt++; if(dx_cnt == n) { adx = dx_sum / n; ready = true; } }
      else adx = (adx * (n - 1) + dx) / n;
     }
   return ready ? adx : 100.0;
  }

double RealizedVol(const MqlRates &r[], const int shift, const int n)
  {
   double s = 0, s2 = 0;
   for(int i = shift; i < shift + n; i++) { double x = MathLog(r[i].close / r[i + 1].close); s += x; s2 += x * x; }
   double mean = s / n;
   return MathSqrt(MathMax((s2 - n * mean * mean) / (n - 1), 0.0));
  }

//==================================================================== account / risk
void ParseStages()
  {
   ArrayResize(g_stage_bal, 0); ArrayResize(g_stage_mult, 0);
   string parts[];
   int n = StringSplit(InpStages, ';', parts);
   for(int i = 0; i < n; i++)
     {
      string kv[];
      if(StringSplit(parts[i], ':', kv) != 2) continue;
      int k = ArraySize(g_stage_bal);
      ArrayResize(g_stage_bal, k + 1); ArrayResize(g_stage_mult, k + 1);
      g_stage_bal[k] = StringToDouble(kv[0]); g_stage_mult[k] = StringToDouble(kv[1]);
     }
   for(int i = 0; i < ArraySize(g_stage_bal); i++)
      for(int j = i + 1; j < ArraySize(g_stage_bal); j++)
         if(g_stage_bal[j] < g_stage_bal[i])
           {
            double tb = g_stage_bal[i]; g_stage_bal[i] = g_stage_bal[j]; g_stage_bal[j] = tb;
            double tm = g_stage_mult[i]; g_stage_mult[i] = g_stage_mult[j]; g_stage_mult[j] = tm;
           }
  }

double StageMult(const double balance)
  {
   double m = 1.0;
   for(int i = 0; i < ArraySize(g_stage_bal); i++) if(balance >= g_stage_bal[i]) m = g_stage_mult[i];
   return m;
  }

double LossPerLot(const string sym, const double dist)
  {
   double ts = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE);
   double tv = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE_LOSS);
   if(tv <= 0) tv = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE);
   if(ts <= 0 || tv <= 0) return 0.0;
   return dist / ts * tv;
  }

bool IsOurMagic(const long mg) { return mg >= InpMagicBase + 1 && mg <= InpMagicBase + 3; }

int CountOurPositions()
  {
   int n = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t != 0 && PositionSelectByTicket(t) && IsOurMagic(PositionGetInteger(POSITION_MAGIC))) n++;
     }
   return n;
  }

ulong FindPosition(const string sym, const long magic)
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0 || !PositionSelectByTicket(t)) continue;
      if(PositionGetInteger(POSITION_MAGIC) == magic && PositionGetString(POSITION_SYMBOL) == sym) return t;
     }
   return 0;
  }

// initial JPY risk stored in the comment ("... r=<jpy>"); falls back to |open - SL|
double OpenRiskJpy(const long only_magic = 0)
  {
   double total = 0.0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0 || !PositionSelectByTicket(t)) continue;
      long mg = PositionGetInteger(POSITION_MAGIC);
      if(!IsOurMagic(mg) || (only_magic != 0 && mg != only_magic)) continue;
      string c = PositionGetString(POSITION_COMMENT);
      int p = StringFind(c, "r=");
      double r = p >= 0 ? StringToDouble(StringSubstr(c, p + 2)) : 0.0;
      if(r <= 0.0)
        {
         string sym = PositionGetString(POSITION_SYMBOL);
         r = LossPerLot(sym, MathAbs(PositionGetDouble(POSITION_PRICE_OPEN) - PositionGetDouble(POSITION_SL)))
             * PositionGetDouble(POSITION_VOLUME);
        }
      total += r;
     }
   return total;
  }

bool EntryAllowed(const string sym, const double max_spread_pips)
  {
   if(GvGet(g_gv_halt, 0.0) > 0.0) return false;
   if(CountOurPositions() >= InpMaxPositions) { Log("SKIP", sym, "max positions"); return false; }
   double daybal = GvGet(g_gv_daybal, AccountInfoDouble(ACCOUNT_EQUITY));
   if(AccountInfoDouble(ACCOUNT_EQUITY) < daybal * (1.0 - InpDailyLossPct / 100.0)) { Log("SKIP", sym, "daily loss limit"); return false; }
   double sp = SpreadPips(sym);
   if(sp > max_spread_pips) { Log("SKIP", sym, StringFormat("spread %.2f pips > %.2f", sp, max_spread_pips)); return false; }
   return true;
  }

// lots for a stop distance (same budget rule as fxlab.engine.run_portfolio); reason set when 0
double LotsFor(const string sym, const double stop_dist, const double book_risk_pct, const long magic,
               const double book_cap_pct, double &risk_jpy, string &reason)
  {
   double bal = AccountInfoDouble(ACCOUNT_BALANCE);
   double peak = GvGet(g_gv_balpeak, bal);
   double throttle = (peak > 0 && 100.0 * (1.0 - bal / peak) >= InpThrottleDDPct) ? InpThrottleMult : 1.0;
   double rf = book_risk_pct / 100.0 * StageMult(bal) * throttle;
   double want = bal * rf;
   double budget = MathMin(want, bal * InpMaxOpenRiskPct / 100.0 - OpenRiskJpy());
   if(book_cap_pct > 0) budget = MathMin(budget, bal * book_cap_pct / 100.0 - OpenRiskJpy(magic));
   risk_jpy = 0.0;
   reason = "";
   if(budget <= 0) { reason = "risk_cap"; return 0.0; }
   double spread = SymbolInfoDouble(sym, SYMBOL_ASK) - SymbolInfoDouble(sym, SYMBOL_BID);
   double per_lot = LossPerLot(sym, stop_dist + spread);
   if(per_lot <= 0) { reason = "no_tick_value"; return 0.0; }
   double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   double vmin = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
   double vmax = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX);
   if(step <= 0) step = 0.01;
   double lots = MathFloor(budget / per_lot / step + 1e-9) * step;
   double price = SymbolInfoDouble(sym, SYMBOL_ASK), margin = 0.0;
   if(lots >= vmin && OrderCalcMargin(ORDER_TYPE_BUY, sym, lots, price, margin) && margin > 0)
     {
      double cap = AccountInfoDouble(ACCOUNT_EQUITY) * InpMarginUsePct / 100.0 - AccountInfoDouble(ACCOUNT_MARGIN);
      if(margin > cap) lots = MathFloor(lots * MathMax(cap, 0.0) / margin / step + 1e-9) * step;
     }
   if(lots < vmin - 1e-12) { reason = budget < want ? "risk_cap" : "below_min_lot"; return 0.0; }   // never round up
   lots = MathMin(lots, vmax);
   risk_jpy = lots * per_lot;
   return lots;
  }

bool OpenMarket(const string sym, const int dir, const double stop_dist, const double book_risk_pct,
                const long magic, const string tag, const double max_spread, const double book_cap_pct)
  {
   g_send_rc = 0;
   if(!EntryAllowed(sym, max_spread)) return false;
   double risk_jpy = 0.0;
   string reason;
   double lots = LotsFor(sym, stop_dist, book_risk_pct, magic, book_cap_pct, risk_jpy, reason);
   if(lots <= 0) { Log("SKIP", sym, tag + " " + reason); return false; }
   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double bid = SymbolInfoDouble(sym, SYMBOL_BID), ask = SymbolInfoDouble(sym, SYMBOL_ASK);
   // a buy stop triggers on Bid, a sell stop on Ask: the stop sits stop_dist from the entry MID
   // (Python parity); the loss at the stop is stop_dist + spread, exactly what LotsFor sized for
   double sl = NormalizeDouble(dir > 0 ? bid - stop_dist : ask + stop_dist, digits);
   string cmt = StringFormat("%s r=%.0f", tag, risk_jpy);
   g_trade.SetExpertMagicNumber(magic);
   g_trade.SetTypeFillingBySymbol(sym);
   bool ok = dir > 0 ? g_trade.Buy(lots, sym, 0.0, sl, 0.0, cmt) : g_trade.Sell(lots, sym, 0.0, sl, 0.0, cmt);
   g_send_rc = g_trade.ResultRetcode();
   ok = ok && (g_send_rc == TRADE_RETCODE_DONE || g_send_rc == TRADE_RETCODE_DONE_PARTIAL);
   string fill = "";
   ulong deal = g_trade.ResultDeal();
   if(ok && deal > 0 && HistoryDealSelect(deal))
      fill = StringFormat(" fill=%s fill_ms=%I64d", DoubleToString(HistoryDealGetDouble(deal, DEAL_PRICE), digits),
                          HistoryDealGetInteger(deal, DEAL_TIME_MSC));
   Log(ok ? "OPEN" : "ERR_OPEN", sym, StringFormat("%s dir=%d lots=%.2f bid=%s ask=%s sl=%s risk=%.0f rc=%u%s", tag, dir, lots,
       DoubleToString(bid, digits), DoubleToString(ask, digits), DoubleToString(sl, digits), risk_jpy, g_send_rc, fill));
   return ok;
  }

// retcodes after which the server certainly did NOT execute the order (safe to resend)
bool SafeToRetry(const uint rc)
  {
   return rc == 0 || rc == TRADE_RETCODE_REQUOTE || rc == TRADE_RETCODE_REJECT || rc == TRADE_RETCODE_PRICE_CHANGED
          || rc == TRADE_RETCODE_PRICE_OFF || rc == TRADE_RETCODE_TOO_MANY_REQUESTS || rc == TRADE_RETCODE_LOCKED
          || rc == TRADE_RETCODE_CLIENT_DISABLES_AT;
  }

bool ClosePos(const ulong ticket, const string sym, const string why)
  {
   g_trade.SetTypeFillingBySymbol(sym);
   g_trade.LogLevel(LOG_LEVEL_NO);
   bool ok = g_trade.PositionClose(ticket, InpDeviationPts);
   g_trade.LogLevel(LOG_LEVEL_ERRORS);
   Log(ok ? "CLOSE" : "ERR_CLOSE", sym, why + StringFormat(" rc=%u %s", g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription()));
   return ok;
  }

void CloseAll(const string why)
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0 || !PositionSelectByTicket(t) || !IsOurMagic(PositionGetInteger(POSITION_MAGIC))) continue;
      ClosePos(t, PositionGetString(POSITION_SYMBOL), why);
     }
  }

// while halted: keep flattening until none of our positions is left (only symbols with fresh quotes)
void HaltFlatten()
  {
   datetime now = Now();
   if(now - g_halt_retry < 5) return;
   g_halt_retry = now;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0 || !PositionSelectByTicket(t) || !IsOurMagic(PositionGetInteger(POSITION_MAGIC))) continue;
      string sym = PositionGetString(POSITION_SYMBOL);
      if(!g_tester && now - (datetime)SymbolInfoInteger(sym, SYMBOL_TIME) > 60) continue;   // market closed: wait
      ClosePos(t, sym, "HALT retry");
     }
  }

// Deposits / withdrawals from the deal history are applied once to the peaks and the daily
// reference (plan.py rule: deposit -> peak += amount; withdrawal -> peak scaled by the ratio of
// the balance after/before, tax is not a trading drawdown).  Returns false while the history does
// not reconcile with the account (a deal is in flight): peaks and the halt test then wait.
// rebase=true (after a fallback period in which raw peaks already absorbed deposits): deposits are
// not added again, withdrawals are still scaled.
bool ReconcileCashFlows(const double bal, const double eq, const bool rebase)
  {
   if(g_tester) return true;
   if(!HistorySelect(0, D'3000.12.31 23:59:59')) return false;     // independent of the last quote time
   double last = GvGet(g_gv_flowtk, -1.0);
   double cred = AccountInfoDouble(ACCOUNT_CREDIT);
   double flt = eq - bal - cred;                                    // floating P/L only
   double run = 0.0, crun = 0.0, newest = MathMax(last, 0.0);
   double bpk = GvGet(g_gv_balpeak, bal), epk = GvGet(g_gv_eqpeak, eq), dref = GvGet(g_gv_daybal, eq);
   bool applied = false;
   string msgs = "";
   int n = HistoryDealsTotal();
   for(int i = 0; i < n; i++)
     {
      ulong d = HistoryDealGetTicket(i);
      if(d == 0) return false;
      long   t = HistoryDealGetInteger(d, DEAL_TYPE);
      double a = HistoryDealGetDouble(d, DEAL_PROFIT);
      if(t == DEAL_TYPE_BALANCE || t == DEAL_TYPE_CREDIT)
        {
         if(last >= 0.0 && (double)d > last && a != 0.0 && !(rebase && a > 0.0))
           {
            double b0 = run, e0 = run + crun + flt;                 // balance / equity just before this deal
            if(a > 0.0) { if(t == DEAL_TYPE_BALANCE) bpk += a; epk += a; dref += a; }
            else
              {
               if(t == DEAL_TYPE_BALANCE) bpk = (b0 + a > 0.0 && b0 > 0.0) ? bpk * (b0 + a) / b0 : bal;
               epk  = (e0 + a > 0.0 && e0 > 0.0) ? epk * (e0 + a) / e0 : eq;
               dref = (e0 + a > 0.0 && e0 > 0.0) ? dref * (e0 + a) / e0 : eq;
              }
            applied = true;
            msgs += StringFormat("%s %+.0f JPY (balance before %.0f); ", t == DEAL_TYPE_CREDIT ? "credit" : "balance", a, b0);
           }
         newest = MathMax(newest, (double)d);
         if(t == DEAL_TYPE_CREDIT) crun += a;
        }
      if(t != DEAL_TYPE_CREDIT)
         run += a + HistoryDealGetDouble(d, DEAL_SWAP) + HistoryDealGetDouble(d, DEAL_COMMISSION) + HistoryDealGetDouble(d, DEAL_FEE);
     }
   if(MathAbs(run - bal) >= 1.0 || MathAbs(crun - cred) >= 1.0) return false;   // in flight
   if(last < 0.0) { GlobalVariableSet(g_gv_flowtk, newest); GvFlush(); return true; }   // first run: baseline
   if(applied)
     {
      GlobalVariableSet(g_gv_balpeak, MathMax(bpk, 1.0));
      GlobalVariableSet(g_gv_eqpeak, MathMax(epk, 1.0));
      GlobalVariableSet(g_gv_daybal, MathMax(dref, 1.0));
      GlobalVariableSet(g_gv_flowtk, newest);
      GvFlush();
      Log("CASHFLOW", "", msgs + "peaks and daily reference adjusted");
     }
   else if(newest > last) { GlobalVariableSet(g_gv_flowtk, newest); GvFlush(); }
   return true;
  }

void UpdateAccountState()
  {
   double bal = AccountInfoDouble(ACCOUNT_BALANCE), eq = AccountInfoDouble(ACCOUNT_EQUITY);
   if(bal <= 0.0 || eq <= 0.0) return;                    // never act on unsynchronised account data
   if(!g_tester)
     {
      // any deposit / withdrawal / credit moves balance or credit: reconcile BEFORE the peaks move
      double cred = AccountInfoDouble(ACCOUNT_CREDIT);
      bool moved = bal != g_rec_bal || cred != g_rec_cred;
      if(moved || Now() - g_flow_checked >= 5)
        {
         g_flow_checked = Now();
         if(ReconcileCashFlows(bal, eq, g_flow_warned))
           { g_rec_bal = bal; g_rec_cred = cred; g_flow_unsync = 0; g_flow_warned = false; }
         else
           {
            if(g_flow_unsync == 0) g_flow_unsync = Now();
            if(Now() - g_flow_unsync < 30) return;           // in flight: peaks / halt untouched
            if(!g_flow_warned) { g_flow_warned = true; Log("WARN", "", "deal history does not reconcile with the balance - raw peaks used until it does"); }
            g_rec_bal = bal; g_rec_cred = cred;
           }
        }
      else if(g_flow_unsync != 0 && !g_flow_warned) return;  // still waiting for an in-flight deal
     }
   double bpeak = GvGet(g_gv_balpeak, bal);
   if(bal > bpeak) { GlobalVariableSet(g_gv_balpeak, bal); GvFlush(); }
   double epeak = GvGet(g_gv_eqpeak, eq);
   if(eq > epeak) { epeak = eq; GlobalVariableSet(g_gv_eqpeak, eq); }
   MqlDateTime t; TimeToStruct(Now(), t);
   double today = t.year * 10000.0 + t.mon * 100.0 + t.day;
   if(GvGet(g_gv_day, 0.0) != today) { GlobalVariableSet(g_gv_day, today); GlobalVariableSet(g_gv_daybal, eq); GvFlush(); }
   if(GvGet(g_gv_halt, 0.0) == 0.0 && InpTargetEquity > 0.0 && eq >= InpTargetEquity)
     {
      GlobalVariableSet(g_gv_halt, 1.0);
      GlobalVariableSet(g_gv_eqpeak, eq);
      GvFlush();
      Notify(StringFormat("TitanPortfolioEA: TARGET REACHED - equity %.0f >= %.0f. Closing all positions and stopping. "
                          "Withdraw the profit before resuming (delete global variable %s).", eq, InpTargetEquity, g_gv_halt));
      CloseAll("TARGET equity reached");
     }
   if(GvGet(g_gv_halt, 0.0) == 0.0 && eq < epeak * (1.0 - InpHaltDDPct / 100.0))
     {
      GlobalVariableSet(g_gv_halt, 1.0);
      GlobalVariableSet(g_gv_eqpeak, eq);                 // re-based: deleting the halt flag resumes against a fresh peak
      GvFlush();
      Notify(StringFormat("TitanPortfolioEA HALTED: equity %.0f is %.1f%% below its peak %.0f. Closing all positions. "
                          "Review (docs/STAGED_PLAN.md), then delete global variable %s (F3) to resume.",
                          eq, 100.0 * (1.0 - eq / epeak), epeak, g_gv_halt));
      CloseAll("HALT equity drawdown limit");
     }
   if(!g_tester && Now() - g_gv_flushed >= 60) { g_gv_flushed = Now(); GvFlush(); }
  }

//==================================================================== GOTOBI book
void ProcessGotobi()
  {
   if(g_gotobi_sym == "") return;
   string sym = g_gotobi_sym;
   datetime now = Now();
   bool clock_ok;
   datetime jst = ServerToJst(now, clock_ok);
   datetime jday = DayStart(jst);
   int jsec = (int)(jst - jday);

   // mechanism monitor: sell-direction mid move 09:55:00 -> 10:05:00 on every gotobi day
   if(g_mech_day != jday) { g_mech_day = jday; g_mech_mid0955 = 0.0; g_mech_done = false; }
   double mid = 0.5 * (SymbolInfoDouble(sym, SYMBOL_BID) + SymbolInfoDouble(sym, SYMBOL_ASK));
   if(!g_mech_done && g_mech_mid0955 == 0.0 && jsec >= InpGotobiEntrySec && jsec < InpGotobiEntrySec + 600 && IsGotobi(jday))
      g_mech_mid0955 = mid;
   if(!g_mech_done && g_mech_mid0955 > 0 && jsec >= InpGotobiEntrySec + 600)
     {
      g_mech_done = true;
      Log("GTB_MECH", sym, StringFormat("mid0955=%.3f mid1005=%.3f sell_move_pips=%.2f", g_mech_mid0955, mid,
          (g_mech_mid0955 - mid) / PipSize(sym)));
     }

   ulong tk = FindPosition(sym, MagicGotobi());
   if(tk != 0)
     {
      bool dummy;
      datetime opened = (datetime)PositionGetInteger(POSITION_TIME);
      bool other_day = DayStart(ServerToJst(opened, dummy)) != jday;
      if(jsec >= InpGotobiExitSec || other_day) ClosePos(tk, sym, "GTB 15:00 JST exit");   // also when the book is off
      return;
     }
   if(!InpGotobiOn) return;                                          // book off: exits only
   if(jsec < InpGotobiEntrySec || jsec >= InpGotobiEntrySec + InpGotobiWindowSec) return;
   if(!g_tester)                                                     // act on quotes stamped inside the window by the SERVER clock
     {
      bool tok;
      datetime tj = ServerToJst((datetime)SymbolInfoInteger(sym, SYMBOL_TIME), tok);
      if(tj < jday + InpGotobiEntrySec || tj >= jday + InpGotobiEntrySec + InpGotobiWindowSec) return;
     }
   double dayid = (double)jday;
   if(GvGet(g_gv_gotobi_day, 0.0) == dayid) return;                  // one trade per JST day
   MqlDateTime js; TimeToStruct(jday, js);
   if(!IsGotobi(jday) || (InpGotobiSkipDec25 && js.mon == 12 && js.day == 25) || !clock_ok)
     { GlobalVariableSet(g_gv_gotobi_day, dayid); GvFlush(); return; }
   MqlDateTime ss; TimeToStruct(now, ss);
   if(ss.hour < 1) return;                                           // never in the rollover hour
   if(!g_tester && TerminalInfoInteger(TERMINAL_CONNECTED) == 0) return;
   MqlRates r[]; ArraySetAsSeries(r, true);
   if(CopyRates(sym, PERIOD_D1, 0, 20, r) < 17) return;
   double atr = AtrSma(r, 1, 14);
   if(atr <= 0) return;
   bool done = OpenMarket(sym, -1, InpGotobiStopAtr * atr, InpGotobiRiskPct, MagicGotobi(), "GTB", InpGotobiMaxSpread, 0.0);
   // retry inside the window only if nothing was sent (e.g. spread) or the server certainly did not execute
   if(done || !SafeToRetry(g_send_rc))
     {
      GlobalVariableSet(g_gv_gotobi_day, dayid);
      GvFlush();
      if(!done) Log("GTB_STOP", sym, StringFormat("no retry today after rc=%u", g_send_rc));
     }
  }

//==================================================================== D1 books
bool NewD1Ready(D1State &st, datetime &bar0)
  {
   bar0 = iTime(st.sym, PERIOD_D1, 0);
   if(bar0 == 0 || bar0 <= st.last_bar) return false;               // unsynced / already processed
   if(Now() < st.retry_at) return false;
   MqlDateTime s; TimeToStruct(Now(), s);
   return s.hour >= 1;                                               // decisions at/after 01:00 server
  }

void MarkDone(D1State &st, const datetime bar0)
  {
   st.last_bar = bar0;
   GlobalVariableSet(st.gv, (double)bar0);
   GvFlush();
  }

bool PastEntryDeadline()                                             // failed entries are retried until 02:00 server
  {
   MqlDateTime s; TimeToStruct(Now(), s);
   return s.hour >= 2;
  }

void ProcessMeanRev(D1State &st)
  {
   datetime bar0;
   if(!NewD1Ready(st, bar0)) return;
   string sym = st.sym;
   MqlRates r[]; ArraySetAsSeries(r, true);
   int total = CopyRates(sym, PERIOD_D1, 0, 1100, r);
   if(total < 1000) { Log("SKIP", sym, "MR needs >= 1000 D1 bars"); st.retry_at = Now() + 60; return; }
   double c1 = r[1].close, c2 = r[2].close;
   double m1 = Sma(r, 1, InpMrBbN), m2 = Sma(r, 2, InpMrBbN);
   double sd1 = StdPop(r, 1, InpMrBbN), sd2 = StdPop(r, 2, InpMrBbN);
   bool L = c2 < m2 - InpMrBbK * sd2 && c1 > m1 - InpMrBbK * sd1;
   bool S = c2 > m2 + InpMrBbK * sd2 && c1 < m1 + InpMrBbK * sd1;
   double atr = AtrSma(r, 1, InpMrAtrN), atr_slow = AtrSma(r, 1, InpMrVolN), atr20 = AtrSma(r, 1, 20);
   double adx = AdxWilder(r, 1, InpMrAdxN, total);
   double ema = Ema(r, 1, InpMrEmaN, total);
   bool regime = adx < InpMrAdxMax && atr_slow > 0 && atr / atr_slow < InpMrVolMax &&
                 atr20 > 0 && MathAbs(c1 - ema) / atr20 < InpMrFlatK;
   L = L && regime; S = S && regime;
   double mexit = Sma(r, 1, InpMrExitN);
   bool xl = c1 > mexit, xs = c1 < mexit;
   L = L && !xl; S = S && !xs;
   double stop = InpMrStopAtr * atr;
   ulong tk = FindPosition(sym, MagicMeanRev());
   if(tk != 0 && PositionSelectByTicket(tk))
     {
      int dir = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1;
      int held = iBarShift(sym, PERIOD_D1, (datetime)PositionGetInteger(POSITION_TIME), false);
      bool rev = (dir > 0 && S) || (dir < 0 && L);
      bool ex = (dir > 0 && xl) || (dir < 0 && xs) || rev || (InpMrMaxHold > 0 && held >= InpMrMaxHold);
      if(!ex) { MarkDone(st, bar0); return; }
      if(!ClosePos(tk, sym, rev ? "MR reverse" : "MR exit")) { st.retry_at = Now() + 15; return; }   // exits: retried until done
     }
   int nd = (L && !S) ? 1 : ((S && !L) ? -1 : 0);
   if(InpMeanRevOn && stop > 0 && nd != 0 &&
      !OpenMarket(sym, nd, stop, InpMeanRevRiskPct, MagicMeanRev(), "MR", InpMaxSpreadPips, 0.0) &&
      SafeToRetry(g_send_rc) && !PastEntryDeadline())
     { st.retry_at = Now() + 15; return; }
   MarkDone(st, bar0);
  }

// rate of `ccy` for calendar `year` from InpRates; false if missing
bool YearRate(const string ccy, const int year, double &rate)
  {
   string rows[];
   int n = StringSplit(InpRates, ';', rows);
   for(int i = 0; i < n; i++)
     {
      string yr[];
      if(StringSplit(rows[i], ':', yr) != 2) continue;
      if((int)StringToInteger(yr[0]) != year) continue;
      string kv[];
      int m = StringSplit(yr[1], ',', kv);
      for(int j = 0; j < m; j++)
        {
         string p[];
         if(StringSplit(kv[j], '=', p) == 2)
           {
            StringTrimLeft(p[0]); StringTrimRight(p[0]);
            if(p[0] == ccy) { rate = StringToDouble(p[1]); return true; }
           }
        }
     }
   return false;
  }

// carry direction for decisions in `year` (uses year-1); ok=false when the row is missing
int CarryDir(const string sym, const int year, bool &ok)
  {
   double rb, rq;
   string base = StringSubstr(sym, 0, 3), quote = StringSubstr(sym, 3, 3);
   ok = YearRate(base, year - 1, rb) && YearRate(quote, year - 1, rq);
   if(!ok) return 0;
   double diff = rb - rq;
   if(diff >= InpCarryMinDiff) return 1;
   if(diff <= -InpCarryMinDiff) return -1;
   return 0;
  }

void ProcessCarry(D1State &st)
  {
   datetime bar0;
   if(!NewD1Ready(st, bar0)) return;
   string sym = st.sym;
   MqlRates r[]; ArraySetAsSeries(r, true);
   int total = CopyRates(sym, PERIOD_D1, 0, 700, r);
   if(total < InpCarryVolSlow + 60) { Log("SKIP", sym, "CARRY needs more D1 history"); st.retry_at = Now() + 60; return; }
   MqlDateTime s1; TimeToStruct(r[1].time, s1);
   MqlDateTime s2; TimeToStruct(r[2].time, s2);
   bool ok1, ok2;
   int cd = CarryDir(sym, s1.year, ok1);
   int cd_prev = CarryDir(sym, s2.year, ok2);
   if(InpCarryOn && !ok1)
     {
      double wday = (double)DayStart(Now());
      if(GvGet(g_gv_ratewarn, 0.0) != wday)
        {
         GlobalVariableSet(g_gv_ratewarn, wday);
         Notify(StringFormat("TitanPortfolioEA: InpRates has no row for %d - carry book flat until it is added", s1.year - 1));
        }
     }
   if(!ok2) cd_prev = cd;                                            // missing Y-2 row: no artificial year flip
   double c1 = r[1].close;
   double ema = Ema(r, 1, InpCarryEmaN, total);
   int trend = c1 > ema ? 1 : (c1 < ema ? -1 : 0);
   double vf = RealizedVol(r, 1, InpCarryVolFast), vs = RealizedVol(r, 1, InpCarryVolSlow);
   double vr = vs > 0 ? vf / vs : 99.0;
   double atr = AtrSma(r, 1, InpCarryAtrN);
   ulong tk = FindPosition(sym, MagicCarry());
   bool trail_failed = false;
   if(tk != 0 && PositionSelectByTicket(tk))
     {
      int dir = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1;
      int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      if(InpCarryTrailAtr > 0)
        {
         MqlRates h[];
         datetime t_open = (datetime)PositionGetInteger(POSITION_TIME);
         datetime t_bar = t_open - (t_open % 3600);                 // include the entry H1 bar (kernel parity)
         int n = CopyRates(sym, PERIOD_H1, t_bar, Now(), h);
         double hh = PositionGetDouble(POSITION_PRICE_OPEN), ll = hh;
         for(int i = 0; i < n; i++) { hh = MathMax(hh, h[i].high); ll = MathMin(ll, h[i].low); }
         double sl = PositionGetDouble(POSITION_SL);
         double spr = SymbolInfoDouble(sym, SYMBOL_ASK) - SymbolInfoDouble(sym, SYMBOL_BID);
         // bars are Bid prices; a short stop triggers on Ask -> add the spread for mid parity
         double ns = NormalizeDouble(dir > 0 ? hh - InpCarryTrailAtr * atr : ll + spr + InpCarryTrailAtr * atr, digits);
         if((dir > 0 && ns > sl) || (dir < 0 && (sl == 0 || ns < sl)))
           {
            double bid = SymbolInfoDouble(sym, SYMBOL_BID), ask = SymbolInfoDouble(sym, SYMBOL_ASK);
            if((dir > 0 && bid <= ns) || (dir < 0 && ask >= ns))
              {
               if(!ClosePos(tk, sym, "CARRY trail beyond price")) { st.retry_at = Now() + 15; return; }
               tk = 0;
              }
            else
              {
               g_trade.SetExpertMagicNumber(MagicCarry());
               if(g_trade.PositionModify(tk, ns, 0.0)) Log("TRAIL", sym, DoubleToString(ns, digits));
               else
                 {
                  trail_failed = true;                               // exits must still be evaluated
                  Log("ERR_TRAIL", sym, StringFormat("%s rc=%u", DoubleToString(ns, digits), g_trade.ResultRetcode()));
                 }
              }
           }
        }
      if(tk != 0)
        {
         bool brk = dir > 0 ? trend <= 0 : trend >= 0;
         bool ex = brk || vr >= InpCarryVolExit || cd == 0 || cd != cd_prev || cd != dir;
         if(!ex)
           {
            if(trail_failed && !PastEntryDeadline()) { st.retry_at = Now() + 15; return; }
            MarkDone(st, bar0);
            return;
           }
         if(!ClosePos(tk, sym, "CARRY exit")) { st.retry_at = Now() + 15; return; }
        }
     }
   if(InpCarryOn && cd != 0 && trend == cd && vr < InpCarryVolEntry && atr > 0 &&
      !OpenMarket(sym, cd, InpCarryStopAtr * atr, InpCarryRiskPct, MagicCarry(), "CRY", InpMaxSpreadPips, InpCarryBookCapPct) &&
      SafeToRetry(g_send_rc) && !PastEntryDeadline())
     { st.retry_at = Now() + 15; return; }
   MarkDone(st, bar0);
  }

//==================================================================== init / events
void LoadSymbols(const string csv, D1State &arr[], const string book)
  {
   string parts[];
   int n = StringSplit(csv, ',', parts);
   ArrayResize(arr, 0);
   for(int i = 0; i < n; i++)
     {
      string s = parts[i];
      StringTrimLeft(s); StringTrimRight(s);
      if(s == "") continue;
      s += InpSymbolSuffix;
      if(!SymbolSelect(s, true)) { Print("symbol not available: ", s); continue; }
      int k = ArraySize(arr);
      ArrayResize(arr, k + 1);
      arr[k].sym = s;
      arr[k].gv = g_prefix + book + "_" + s;
      arr[k].retry_at = 0;
      if(GlobalVariableCheck(arr[k].gv) && !g_tester) arr[k].last_bar = (datetime)GlobalVariableGet(arr[k].gv);
      else
        {
         // first start: never act on the D1 bar that is already open (D1 bars open at 00:00 server)
         datetime t0 = iTime(s, PERIOD_D1, 0), d0 = DayStart(Now());
         arr[k].last_bar = t0 > d0 ? t0 : d0;
        }
     }
  }

void LoadExtraHolidays()
  {
   ArrayResize(g_extra_hol, 0);
   string parts[];
   int n = StringSplit(InpJpExtraHolidays, ';', parts);
   for(int i = 0; i < n; i++)
     {
      string s = parts[i];
      StringTrimLeft(s); StringTrimRight(s);
      if(s != "") AddDate(g_extra_hol, DayStart(StringToTime(s)));
     }
  }

bool ValidateRates()
  {
   string rows[];
   int n = StringSplit(InpRates, ';', rows);
   int years[];
   string ccys[6] = {"USD", "EUR", "JPY", "GBP", "AUD", "CAD"};
   for(int i = 0; i < n; i++)
     {
      string yr[];
      if(StringSplit(rows[i], ':', yr) != 2) { Print("InpRates: bad row '", rows[i], "'"); return false; }
      int y = (int)StringToInteger(yr[0]);
      for(int k = 0; k < ArraySize(years); k++) if(years[k] == y) { Print("InpRates: duplicate year ", y); return false; }
      int m = ArraySize(years); ArrayResize(years, m + 1); years[m] = y;
      for(int c = 0; c < 6; c++)
        {
         double v;
         if(!YearRate(ccys[c], y, v) || v < -1.0 || v > 20.0) { Print("InpRates: ", y, " ", ccys[c], " missing or out of range"); return false; }
        }
     }
   return true;
  }

bool AccountReady()
  {
   if(g_tester) return true;
   return TerminalInfoInteger(TERMINAL_CONNECTED) != 0 && AccountInfoInteger(ACCOUNT_LOGIN) != 0
          && AccountInfoDouble(ACCOUNT_BALANCE) > 0.0 && AccountInfoDouble(ACCOUNT_EQUITY) > 0.0;
  }

double LockId() { return (double)(ChartID() & 0x7FFFFFFF) + 1.0; }

// runs once, from the first timer event after the terminal is logged in
bool LateInit()
  {
   if((ENUM_ACCOUNT_MARGIN_MODE)AccountInfoInteger(ACCOUNT_MARGIN_MODE) != ACCOUNT_MARGIN_MODE_RETAIL_HEDGING)
     {
      Print("TitanPortfolioEA requires a HEDGING account (books may hold opposite positions on one symbol).");
      ExpertRemove();
      return false;
     }
   // state names are tied to the account login, so demo state never leaks into a live account
   g_prefix = "TPEA_" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "_" + IntegerToString(InpMagicBase) + "_";
   g_gv_balpeak = g_prefix + "balpeak"; g_gv_eqpeak = g_prefix + "eqpeak"; g_gv_halt = g_prefix + "halt";
   g_gv_day = g_prefix + "day"; g_gv_daybal = g_prefix + "daybal"; g_gv_gotobi_day = g_prefix + "gotobi_day";
   g_gv_ratewarn = g_prefix + "ratewarn"; g_gv_flowtk = g_prefix + "flowtk";
   if(g_tester) GlobalVariablesDeleteAll(g_prefix);
   g_trade.SetDeviationInPoints(InpDeviationPts);
   g_trade.SetMarginMode();
   ParseStages();
   LoadExtraHolidays();
   if(AccountInfoString(ACCOUNT_CURRENCY) != "JPY")
      Print("warning: account currency is ", AccountInfoString(ACCOUNT_CURRENCY), " - risk is still % of balance");
   // symbols are always resolved, so positions of a switched-off book are still managed (exits only)
   g_gotobi_sym = InpGotobiSymbol + InpSymbolSuffix;
   if(!SymbolSelect(g_gotobi_sym, true)) { Print("gotobi symbol not available: ", g_gotobi_sym); g_gotobi_sym = ""; }
   LoadSymbols(InpMrSymbols, g_mr, "mr");
   LoadSymbols(InpCarrySymbols, g_carry, "carry");
   if(InpLogCsv)
     {
      g_csv = FileOpen("TitanPortfolioEA_" + IntegerToString(InpMagicBase) + (g_tester ? "_tester" : "") + ".csv",
                       FILE_WRITE | FILE_READ | FILE_CSV | FILE_ANSI | FILE_SHARE_READ, ',');
      if(g_csv != INVALID_HANDLE) FileSeek(g_csv, 0, SEEK_END);
      else Print("TitanPortfolioEA: CSV log not opened (another instance with the same InpMagicBase?), error ", GetLastError());
     }
   datetime now = Now();
   bool ok;
   datetime jst = ServerToJst(now, ok);
   Log("INIT", "", StringFormat("v1.22 login=%I64d server=%s rule=GMT+%d live=GMT+%d jst=%s gotobi_today=%d balance=%.0f books=%s%s%s",
       AccountInfoInteger(ACCOUNT_LOGIN), TimeToString(now), RuleOffset(now), LiveOffset(), TimeToString(jst),
       (int)IsGotobi(DayStart(jst)), AccountInfoDouble(ACCOUNT_BALANCE),
       InpGotobiOn ? "G" : "", InpMeanRevOn ? "M" : "", InpCarryOn ? "C" : ""));
   return true;
  }

int OnInit()
  {
   g_tester = (bool)MQLInfoInteger(MQL_TESTER);
   // globals survive REASON_PARAMETERS / REASON_CHARTCHANGE re-inits: reset them
   ArrayResize(g_mr, 0); ArrayResize(g_carry, 0);
   g_gotobi_sym = ""; g_prefix = ""; g_ready = false; g_csv = INVALID_HANDLE;
   ArrayResize(g_err_key, 0); ArrayResize(g_err_t, 0);
   g_flow_unsync = 0; g_flow_checked = 0; g_flow_warned = false; g_rec_bal = -1.0; g_rec_cred = -1.0;
   if(InpCarryOn && !ValidateRates()) return INIT_PARAMETERS_INCORRECT;
   // single instance per terminal and magic (a second chart would double the gotobi risk)
   g_gv_lock = "TPEA_" + IntegerToString(InpMagicBase) + "_lock";
   if(!g_tester)
     {
      if(!GlobalVariableCheck(g_gv_lock)) GlobalVariableTemp(g_gv_lock);
      if(GlobalVariableGet(g_gv_lock) != LockId() && !GlobalVariableSetOnCondition(g_gv_lock, LockId(), 0.0))
        {
         Print("TitanPortfolioEA (InpMagicBase=", InpMagicBase, ") is already running on another chart of this terminal. ",
               "If not (stale lock after a crash), delete global variable ", g_gv_lock, " (F3) and re-attach.");
         return INIT_FAILED;
        }
     }
   EventSetMillisecondTimer(250);
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   if(!g_tester && g_gv_lock != "" && GlobalVariableCheck(g_gv_lock) && GlobalVariableGet(g_gv_lock) == LockId())
      GlobalVariableSet(g_gv_lock, 0.0);
   GvFlush();
   if(g_csv != INVALID_HANDLE) { FileClose(g_csv); g_csv = INVALID_HANDLE; }
  }

void OnTimer()
  {
   UpdateClockSkew();
   if(!AccountReady()) return;                                       // not logged in / disconnected
   if(!g_ready) { if(!LateInit()) return; g_ready = true; }
   UpdateAccountState();
   if(GvGet(g_gv_halt, 0.0) > 0.0) { HaltFlatten(); return; }        // halted: stay flat, retry failed closes
   ProcessGotobi();
   for(int i = 0; i < ArraySize(g_mr); i++)
      if(InpMeanRevOn || FindPosition(g_mr[i].sym, MagicMeanRev()) != 0) ProcessMeanRev(g_mr[i]);
   for(int i = 0; i < ArraySize(g_carry); i++)
      if(InpCarryOn || FindPosition(g_carry[i].sym, MagicCarry()) != 0) ProcessCarry(g_carry[i]);
  }

// every closing deal of our books (EA exits AND server-side stop-outs) is logged with its net P&L
void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &request, const MqlTradeResult &result)
  {
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD || trans.deal == 0 || !g_ready) return;
   if(!HistoryDealSelect(trans.deal)) return;
   long mg = HistoryDealGetInteger(trans.deal, DEAL_MAGIC);
   if(!IsOurMagic(mg)) return;
   long entry = HistoryDealGetInteger(trans.deal, DEAL_ENTRY);
   if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_OUT_BY) return;
   double net = HistoryDealGetDouble(trans.deal, DEAL_PROFIT) + HistoryDealGetDouble(trans.deal, DEAL_SWAP)
                + HistoryDealGetDouble(trans.deal, DEAL_COMMISSION) + HistoryDealGetDouble(trans.deal, DEAL_FEE);
   long rsn = HistoryDealGetInteger(trans.deal, DEAL_REASON);
   string reason = rsn == DEAL_REASON_SL ? "SL" : (rsn == DEAL_REASON_SO ? "STOPOUT" : (rsn == DEAL_REASON_EXPERT ? "EXPERT" : "OTHER"));
   string tag = mg == MagicGotobi() ? "GTB" : (mg == MagicMeanRev() ? "MR" : "CRY");
   string sym = HistoryDealGetString(trans.deal, DEAL_SYMBOL);
   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   Log("EXIT", sym, StringFormat("%s magic=%I64d net=%.0f price=%s reason=%s", tag, mg, net,
       DoubleToString(HistoryDealGetDouble(trans.deal, DEAL_PRICE), digits), reason));
  }

void OnTick() { }
//+------------------------------------------------------------------+
