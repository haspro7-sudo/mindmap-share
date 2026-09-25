//+------------------------------------------------------------------+
//| TitanPortfolioEA.mq5                                             |
//| Three low-correlated books for Titan FX MT5 (JPY account, Blade) |
//|   1) GOTOBI   : USDJPY short after the 09:55 JST Tokyo fix on    |
//|                 Japanese gotobi days, flat at 15:00 JST          |
//|   2) MEANREV  : D1 Bollinger re-entry on 5 majors, range filters |
//|   3) CARRY    : D1 carry with trend/volatility protection        |
//| Rules mirror fx_autotrader/fxlab (Python backtest).              |
//| Every position has a server-side stop-loss from the moment it    |
//| is opened.  No martingale, grid or averaging down.               |
//+------------------------------------------------------------------+
#property copyright "fx_autotrader"
#property version   "1.00"
#property description "Gotobi + D1 mean reversion + carry-trend portfolio with staged risk (Titan FX MT5, JPY)."

#include <Trade\Trade.mqh>

//==================================================================== inputs
input group "=== General ==="
input string InpSymbolSuffix    = "";        // e.g. "-m" on Micro accounts, "" on Standard/Blade
input long   InpMagicBase       = 26092600;  // book magics = base+1 (gotobi), +2 (meanrev), +3 (carry)
input int    InpServerDST       = 0;         // server clock: 0 = NY+7h (US DST, Titan FX), 1 = EU DST, 2 = fixed GMT+2, 3 = fixed GMT+3
input bool   InpUseLiveGMT      = true;      // live: trust TimeTradeServer()-TimeGMT() when it disagrees (never in the tester)
input bool   InpLogCsv          = true;

input group "=== Books (risk per trade, % of balance, before stage/throttle) ==="
input bool   InpGotobiOn        = true;
input double InpGotobiRiskPct   = 0.5;
input bool   InpMeanRevOn       = true;
input double InpMeanRevRiskPct  = 0.5;
input bool   InpCarryOn         = true;
input double InpCarryRiskPct    = 0.5;

input group "=== Account risk (stages / drawdown) ==="
input string InpStages          = "0:1.0";   // "balanceJPY:multiplier;..." e.g. "0:1.0;3000000:1.5;10000000:1.5;30000000:1.0"
input double InpMaxOpenRiskPct  = 6.0;       // sum of initial risk of open positions (% of balance)
input int    InpMaxPositions    = 12;
input double InpDD1Pct          = 10.0;      // balance drawdown from peak -> risk x InpDD1Mult
input double InpDD1Mult         = 0.5;
input double InpDD2Pct          = 20.0;
input double InpDD2Mult         = 0.25;
input double InpHaltDDPct       = 30.0;      // equity drawdown from peak -> close all and stop
input double InpDailyLossPct    = 3.0;       // equity loss within a server day -> no new entries that day
input double InpMarginUsePct    = 50.0;

input group "=== Execution ==="
input int    InpDeviationPts    = 20;
input double InpMaxSpreadPips   = 2.0;       // entries are skipped above this spread
input int    InpTimerSec        = 1;

input group "=== GOTOBI book ==="
input string InpGotobiSymbol    = "USDJPY";
input int    InpGotobiEntryMin  = 595;       // 09:55 JST in minutes after midnight
input int    InpGotobiEntryWin  = 10;        // entry allowed until 10:05 JST
input int    InpGotobiExitMin   = 900;       // 15:00 JST
input double InpGotobiStopAtr   = 0.5;       // x D1 ATR(14), last closed bar
input string InpJpExtraHolidays = "";        // extra non-business days "YYYY.MM.DD;YYYY.MM.DD" (ad-hoc holidays)

input group "=== MEANREV book (D1) ==="
input string InpMrSymbols       = "USDJPY,EURUSD,GBPUSD,AUDUSD,USDCAD";
input int    InpMrBbN           = 20;
input double InpMrBbK           = 1.5;
input int    InpMrAdxN          = 14;
input double InpMrAdxMax        = 25.0;
input int    InpMrAtrN          = 14;
input int    InpMrVolN          = 100;
input double InpMrVolMax        = 1.0;
input int    InpMrEmaN          = 200;
input double InpMrFlatK         = 3.0;       // |close-EMA200| < k * ATR(20)
input int    InpMrExitN         = 20;
input double InpMrStopAtr       = 2.5;
input int    InpMrMaxHold       = 10;

input group "=== CARRY book (D1) ==="
input string InpCarrySymbols    = "USDJPY,EURUSD,GBPUSD,AUDUSD,USDCAD,EURJPY,GBPJPY,AUDJPY,CADJPY,EURGBP,EURAUD,GBPAUD,EURCAD,AUDCAD,GBPCAD";
// annual-average policy rates (%) by year; the EA uses the PREVIOUS year's row.  Update every January.
input string InpRates           = "2024:USD=5.1,EUR=3.6,JPY=0.1,GBP=5.1,AUD=4.4,CAD=4.4;2025:USD=4.2,EUR=2.2,JPY=0.5,GBP=4.3,AUD=3.9,CAD=2.8;2026:USD=3.6,EUR=2.0,JPY=0.8,GBP=3.8,AUD=3.6,CAD=2.4";
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
  };

CTrade    g_trade;
D1State   g_mr[];
D1State   g_carry[];
string    g_gotobi_sym;
double    g_stage_bal[];
double    g_stage_mult[];
string    g_gv_peak, g_gv_halt, g_gv_day, g_gv_daybal, g_gv_gotobi_day;
int       g_csv = INVALID_HANDLE;
datetime  g_extra_hol[];
bool      g_tester = false;

long MagicGotobi()  { return InpMagicBase + 1; }
long MagicMeanRev() { return InpMagicBase + 2; }
long MagicCarry()   { return InpMagicBase + 3; }

//==================================================================== logging / utils
string   g_last_skip = "";
datetime g_last_skip_t = 0;

void Log(const string what, const string sym, const string detail)
  {
   if(what == "SKIP")
     {
      string key = sym + "|" + detail;
      if(key == g_last_skip && TimeCurrent() - g_last_skip_t < 300) return;   // no log spam
      g_last_skip = key; g_last_skip_t = TimeCurrent();
     }
   string line = StringFormat("%s,%s,%s,%s", TimeToString(TimeCurrent(), TIME_DATE | TIME_SECONDS), what, sym, detail);
   Print(line);
   if(InpLogCsv && g_csv != INVALID_HANDLE) { FileWrite(g_csv, line); FileFlush(g_csv); }
  }

double GvGet(const string name, const double def)
  {
   if(GlobalVariableCheck(name)) return GlobalVariableGet(name);
   GlobalVariableSet(name, def);
   return def;
  }

double PipSize(const string sym)
  {
   string base = StringSubstr(sym, 0, 3), quote = StringSubstr(sym, 3, 3);
   if(base == "XAU" || base == "XAG") return 0.01;
   return quote == "JPY" ? 0.01 : 0.0001;
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
// n-th Sunday of a month (n=1..)
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

// hours to ADD to server time to get UTC (e.g. -2 in winter, -3 in summer)
int ServerToUtcHours(const datetime server)
  {
   if(!g_tester && InpUseLiveGMT)
     {
      long diff = (long)TimeTradeServer() - (long)TimeGMT();
      int h = (int)MathRound(diff / 3600.0);
      if(h >= -12 && h <= 14) return -h;
     }
   MqlDateTime s; TimeToStruct(server, s);
   datetime d = DayStart(server);
   bool summer = false;
   if(InpServerDST == 0)       summer = d >= NthSunday(s.year, 3, 2) && d < NthSunday(s.year, 11, 1);
   else if(InpServerDST == 1)  summer = d >= LastSunday(s.year, 3) && d < LastSunday(s.year, 10);
   else if(InpServerDST == 3)  summer = true;
   return summer ? -3 : -2;
  }

datetime ServerToJst(const datetime server) { return server + (ServerToUtcHours(server) + 9) * 3600; }

//==================================================================== Japanese calendar (port of fxlab/strategies/seasonality.py)
datetime NthMonday(const int y, const int m, const int n)
  {
   datetime first = MakeDate(y, m, 1);
   int add = (8 - Dow(first)) % 7;            // days to the first Monday
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
      AddDate(h, NthMonday(y, 7, 3));                 // Marine Day
      AddDate(h, NthMonday(y, 10, 2));                // Sports Day
      if(y >= 2016) AddDate(h, MakeDate(y, 8, 11));   // Mountain Day
     }
   AddDate(h, NthMonday(y, 9, 3));                    // Respect for the Aged Day
   if(y == 2019) { AddDate(h, MakeDate(2019, 4, 30)); AddDate(h, MakeDate(2019, 5, 1)); AddDate(h, MakeDate(2019, 5, 2)); AddDate(h, MakeDate(2019, 10, 22)); }
   // citizens' holiday: a non-Sunday day sandwiched between two holidays
   int n0 = ArraySize(h);
   datetime base[]; ArrayResize(base, n0);
   for(int i = 0; i < n0; i++) base[i] = h[i];
   for(int i = 0; i < n0; i++)
     {
      datetime mid = base[i] + 86400;
      if(!InList(h, mid) && InList(h, mid + 86400) && Dow(mid) != 0) AddDate(h, mid);
     }
   // substitute holiday: a holiday on Sunday moves to the next non-holiday day
   int n1 = ArraySize(h);
   datetime snap[]; ArrayResize(snap, n1);
   for(int i = 0; i < n1; i++) snap[i] = h[i];
   ArraySort(snap);
   for(int i = 0; i < n1; i++)
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

// gotobi = last Japanese business day on/before the 5,10,15,20,25 and month end
bool IsGotobi(const datetime day)
  {
   MqlDateTime s; TimeToStruct(day, s);
   for(int k = 0; k < 2; k++)                       // targets of this month and the next
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

// EMA seeded with the oldest available close (pandas ewm(adjust=False)), value at `shift`
double Ema(const MqlRates &r[], const int shift, const int n, const int total)
  {
   double a = 2.0 / (n + 1.0);
   double e = r[total - 1].close;
   for(int i = total - 2; i >= shift; i--) e = a * r[i].close + (1.0 - a) * e;
   return e;
  }

// Wilder ADX (MT5 iADXWilder / fxlab.indicators.adx), value at `shift`
double AdxWilder(const MqlRates &r[], const int shift, const int n, const int total)
  {
   int m = total - 1;                  // bars with a previous bar
   double tr_s = 0, p_s = 0, n_s = 0, adx = 0;
   double dx_sum = 0;
   int cnt = 0, dx_cnt = 0;
   bool adx_ready = false;
   for(int i = m - 1; i >= shift; i--)   // oldest -> newest
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
      if(!adx_ready)
        {
         dx_sum += dx; dx_cnt++;
         if(dx_cnt == n) { adx = dx_sum / n; adx_ready = true; }
        }
      else adx = (adx * (n - 1) + dx) / n;
     }
   return adx_ready ? adx : 100.0;      // not enough history -> treated as trending (no entry)
  }

// sample standard deviation (ddof=1) of daily log returns over n bars ending at `shift`
double RealizedVol(const MqlRates &r[], const int shift, const int n)
  {
   double s = 0, s2 = 0;
   for(int i = shift; i < shift + n; i++)
     {
      double x = MathLog(r[i].close / r[i + 1].close);
      s += x; s2 += x * x;
     }
   double mean = s / n;
   return MathSqrt(MathMax((s2 - n * mean * mean) / (n - 1), 0.0));
  }

//==================================================================== account / risk
bool ParseStages()
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
      g_stage_bal[k] = StringToDouble(kv[0]);
      g_stage_mult[k] = StringToDouble(kv[1]);
     }
   // sort ascending by balance threshold
   for(int i = 0; i < ArraySize(g_stage_bal); i++)
      for(int j = i + 1; j < ArraySize(g_stage_bal); j++)
         if(g_stage_bal[j] < g_stage_bal[i])
           {
            double tb = g_stage_bal[i]; g_stage_bal[i] = g_stage_bal[j]; g_stage_bal[j] = tb;
            double tm = g_stage_mult[i]; g_stage_mult[i] = g_stage_mult[j]; g_stage_mult[j] = tm;
           }
   return true;
  }

double StageMult(const double balance)
  {
   double m = 1.0;
   for(int i = 0; i < ArraySize(g_stage_bal); i++) if(balance >= g_stage_bal[i]) m = g_stage_mult[i];
   return m;
  }

double ThrottleMult(const double balance, const double peak)
  {
   double dd = peak > 0 ? 100.0 * (1.0 - balance / peak) : 0.0;
   if(dd >= InpDD2Pct) return InpDD2Mult;
   if(dd >= InpDD1Pct) return InpDD1Mult;
   return 1.0;
  }

double LossPerLot(const string sym, const double dist)
  {
   double ts = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_SIZE);
   double tv = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE_LOSS);
   if(tv <= 0) tv = SymbolInfoDouble(sym, SYMBOL_TRADE_TICK_VALUE);
   if(ts <= 0 || tv <= 0) return 0.0;
   return dist / ts * tv;
  }

double NormalizeLots(const string sym, double lots)
  {
   double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
   double vmin = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
   double vmax = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX);
   if(step <= 0) step = 0.01;
   lots = MathFloor(lots / step + 1e-9) * step;
   if(lots < vmin - 1e-12) return 0.0;
   return MathMin(lots, vmax);
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

// position of `magic` on `sym` (returns ticket or 0)
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

double OpenRiskJpy()
  {
   double total = 0.0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0 || !PositionSelectByTicket(t) || !IsOurMagic(PositionGetInteger(POSITION_MAGIC))) continue;
      string c = PositionGetString(POSITION_COMMENT);
      int p = StringFind(c, "r=");
      if(p >= 0) total += StringToDouble(StringSubstr(c, p + 2));
      else
        {
         string sym = PositionGetString(POSITION_SYMBOL);
         total += LossPerLot(sym, MathAbs(PositionGetDouble(POSITION_PRICE_OPEN) - PositionGetDouble(POSITION_SL)))
                  * PositionGetDouble(POSITION_VOLUME);
        }
     }
   return total;
  }

bool EntryAllowed(const string sym)
  {
   if(GvGet(g_gv_halt, 0.0) > 0.0) return false;
   if(CountOurPositions() >= InpMaxPositions) { Log("SKIP", sym, "max positions"); return false; }
   double daybal = GvGet(g_gv_daybal, AccountInfoDouble(ACCOUNT_BALANCE));
   if(AccountInfoDouble(ACCOUNT_EQUITY) < daybal * (1.0 - InpDailyLossPct / 100.0)) { Log("SKIP", sym, "daily loss limit"); return false; }
   double spread = SymbolInfoDouble(sym, SYMBOL_ASK) - SymbolInfoDouble(sym, SYMBOL_BID);
   if(spread > InpMaxSpreadPips * PipSize(sym)) { Log("SKIP", sym, StringFormat("spread %.1f pips", spread / PipSize(sym))); return false; }
   return true;
  }

// lots for a stop distance; `book_risk_pct` before stage/throttle.  risk_jpy returned.
double LotsFor(const string sym, const double stop_dist, const double book_risk_pct, double &risk_jpy)
  {
   double bal = AccountInfoDouble(ACCOUNT_BALANCE);
   double peak = GvGet(g_gv_peak, bal);
   double rf = book_risk_pct / 100.0 * StageMult(bal) * ThrottleMult(bal, peak);
   double budget = MathMin(bal * rf, bal * InpMaxOpenRiskPct / 100.0 - OpenRiskJpy());
   risk_jpy = 0.0;
   if(budget <= 0) return 0.0;
   double spread = SymbolInfoDouble(sym, SYMBOL_ASK) - SymbolInfoDouble(sym, SYMBOL_BID);
   double per_lot = LossPerLot(sym, stop_dist + spread);
   if(per_lot <= 0) return 0.0;
   double lots = NormalizeLots(sym, budget / per_lot);
   double price = SymbolInfoDouble(sym, SYMBOL_ASK), margin = 0.0;
   if(lots > 0 && OrderCalcMargin(ORDER_TYPE_BUY, sym, lots, price, margin) && margin > 0)
     {
      double cap = AccountInfoDouble(ACCOUNT_EQUITY) * InpMarginUsePct / 100.0 - AccountInfoDouble(ACCOUNT_MARGIN);
      if(margin > cap) lots = NormalizeLots(sym, lots * MathMax(cap, 0.0) / margin);
     }
   risk_jpy = lots * per_lot;
   return lots;
  }

bool OpenMarket(const string sym, const int dir, const double stop_dist, const double book_risk_pct,
                const long magic, const string tag)
  {
   if(!EntryAllowed(sym)) return false;
   double risk_jpy = 0.0;
   double lots = LotsFor(sym, stop_dist, book_risk_pct, risk_jpy);
   if(lots <= 0) { Log("SKIP", sym, tag + " lots=0 (below min lot or risk cap)"); return false; }
   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double px = dir > 0 ? SymbolInfoDouble(sym, SYMBOL_ASK) : SymbolInfoDouble(sym, SYMBOL_BID);
   double sl = NormalizeDouble(px - dir * stop_dist, digits);
   string cmt = StringFormat("%s r=%.0f", tag, risk_jpy);
   g_trade.SetExpertMagicNumber(magic);
   g_trade.SetTypeFillingBySymbol(sym);
   bool ok = dir > 0 ? g_trade.Buy(lots, sym, 0.0, sl, 0.0, cmt) : g_trade.Sell(lots, sym, 0.0, sl, 0.0, cmt);
   Log(ok ? "OPEN" : "ERR_OPEN", sym, StringFormat("%s dir=%d lots=%.2f sl=%s risk=%.0f rc=%d", tag, dir, lots,
       DoubleToString(sl, digits), risk_jpy, (int)g_trade.ResultRetcode()));
   return ok;
  }

bool ClosePos(const ulong ticket, const string sym, const string why)
  {
   g_trade.SetTypeFillingBySymbol(sym);
   bool ok = g_trade.PositionClose(ticket, InpDeviationPts);
   Log(ok ? "CLOSE" : "ERR_CLOSE", sym, why + StringFormat(" rc=%d", (int)g_trade.ResultRetcode()));
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

void UpdateAccountState()
  {
   double bal = AccountInfoDouble(ACCOUNT_BALANCE), eq = AccountInfoDouble(ACCOUNT_EQUITY);
   double peak = GvGet(g_gv_peak, bal);
   if(bal > peak) { peak = bal; GlobalVariableSet(g_gv_peak, peak); }
   MqlDateTime t; TimeToStruct(TimeCurrent(), t);
   double today = t.year * 10000.0 + t.mon * 100.0 + t.day;
   if(GvGet(g_gv_day, 0.0) != today) { GlobalVariableSet(g_gv_day, today); GlobalVariableSet(g_gv_daybal, bal); }
   if(GvGet(g_gv_halt, 0.0) == 0.0 && eq < peak * (1.0 - InpHaltDDPct / 100.0))
     {
      GlobalVariableSet(g_gv_halt, 1.0);
      CloseAll("HALT equity drawdown limit");
      Alert("TitanPortfolioEA halted (equity drawdown limit). Review, then delete global variable ", g_gv_halt, " to resume.");
     }
  }

//==================================================================== GOTOBI book
void ProcessGotobi()
  {
   if(!InpGotobiOn || g_gotobi_sym == "") return;
   string sym = g_gotobi_sym;
   datetime now = TimeCurrent();
   datetime jst = ServerToJst(now);
   datetime jday = DayStart(jst);
   int jmin = (int)((jst - jday) / 60);
   ulong tk = FindPosition(sym, MagicGotobi());
   if(tk != 0)
     {
      // flat at 15:00 JST (or any later time / next day if the close was missed)
      datetime opened = (datetime)PositionGetInteger(POSITION_TIME);
      bool other_day = DayStart(ServerToJst(opened)) != jday;
      if(jmin >= InpGotobiExitMin || other_day) ClosePos(tk, sym, "gotobi 15:00 JST exit");
      return;
     }
   if(jmin < InpGotobiEntryMin || jmin >= InpGotobiEntryMin + InpGotobiEntryWin) return;
   double dayid = (double)jday;
   if(GvGet(g_gv_gotobi_day, 0.0) == dayid) return;            // one attempt per day
   if(!IsGotobi(jday)) { GlobalVariableSet(g_gv_gotobi_day, dayid); return; }
   MqlDateTime s; TimeToStruct(now, s);
   if(s.hour < 1) return;                                        // never in the rollover hour
   MqlRates r[]; ArraySetAsSeries(r, true);
   if(CopyRates(sym, PERIOD_D1, 0, 20, r) < 17) return;
   double atr = AtrSma(r, 1, 14);
   if(atr <= 0) return;
   // retried every timer tick inside the entry window (e.g. while the spread is too wide)
   if(OpenMarket(sym, -1, InpGotobiStopAtr * atr, InpGotobiRiskPct, MagicGotobi(), "GTB"))
      GlobalVariableSet(g_gv_gotobi_day, dayid);
  }

//==================================================================== D1 books
bool NewD1Ready(D1State &st, datetime &bar0)
  {
   bar0 = iTime(st.sym, PERIOD_D1, 0);
   if(bar0 == 0 || bar0 == st.last_bar) return false;
   MqlDateTime s; TimeToStruct(TimeCurrent(), s);
   if(s.hour < 1) return false;                   // D1 decisions are executed at/after 01:00 server
   return true;
  }

void ProcessMeanRev(D1State &st)
  {
   datetime bar0;
   if(!NewD1Ready(st, bar0)) return;
   string sym = st.sym;
   int total = 600;
   MqlRates r[]; ArraySetAsSeries(r, true);
   int got = CopyRates(sym, PERIOD_D1, 0, total, r);
   if(got < 260) return;
   total = got;
   st.last_bar = bar0;
   double c1 = r[1].close, c2 = r[2].close;
   double m1 = Sma(r, 1, InpMrBbN), m2 = Sma(r, 2, InpMrBbN);
   double sd1 = StdPop(r, 1, InpMrBbN), sd2 = StdPop(r, 2, InpMrBbN);
   double lb1 = m1 - InpMrBbK * sd1, ub1 = m1 + InpMrBbK * sd1;
   double lb2 = m2 - InpMrBbK * sd2, ub2 = m2 + InpMrBbK * sd2;
   bool L = c2 < lb2 && c1 > lb1;
   bool S = c2 > ub2 && c1 < ub1;
   double adx = AdxWilder(r, 1, InpMrAdxN, total);
   double atr = AtrSma(r, 1, InpMrAtrN);
   double atr_slow = AtrSma(r, 1, InpMrVolN);
   double atr20 = AtrSma(r, 1, 20);
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
      datetime opened = (datetime)PositionGetInteger(POSITION_TIME);
      int held = iBarShift(sym, PERIOD_D1, opened, false);
      bool rev = (dir > 0 && S) || (dir < 0 && L);
      bool ex = (dir > 0 && xl) || (dir < 0 && xs) || rev || (InpMrMaxHold > 0 && held >= InpMrMaxHold);
      if(!ex) return;
      if(!ClosePos(tk, sym, rev ? "MR reverse" : "MR exit")) return;
     }
   if(L && !S && stop > 0) OpenMarket(sym, 1, stop, InpMeanRevRiskPct, MagicMeanRev(), "MR");
   else if(S && !L && stop > 0) OpenMarket(sym, -1, stop, InpMeanRevRiskPct, MagicMeanRev(), "MR");
  }

// previous-year policy rate for a currency from InpRates; returns false if missing
bool PrevYearRate(const string ccy, const int year, double &rate)
  {
   string rows[];
   int n = StringSplit(InpRates, ';', rows);
   for(int i = 0; i < n; i++)
     {
      string yr[];
      if(StringSplit(rows[i], ':', yr) != 2) continue;
      if((int)StringToInteger(yr[0]) != year - 1) continue;
      string kv[];
      int m = StringSplit(yr[1], ',', kv);
      for(int j = 0; j < m; j++)
        {
         string p[];
         if(StringSplit(kv[j], '=', p) == 2 && p[0] == ccy) { rate = StringToDouble(p[1]); return true; }
        }
     }
   return false;
  }

int CarryDir(const string sym, const int year)
  {
   double rb, rq;
   string base = StringSubstr(sym, 0, 3), quote = StringSubstr(sym, 3, 3);
   if(!PrevYearRate(base, year, rb) || !PrevYearRate(quote, year, rq)) return 0;
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
   int total = 700;
   MqlRates r[]; ArraySetAsSeries(r, true);
   int got = CopyRates(sym, PERIOD_D1, 0, total, r);
   if(got < InpCarryVolSlow + 60) return;
   total = got;
   st.last_bar = bar0;
   MqlDateTime s1; TimeToStruct(r[1].time, s1);
   MqlDateTime s2; TimeToStruct(r[2].time, s2);
   int cd = CarryDir(sym, s1.year);
   int cd_prev = CarryDir(sym, s2.year);
   double c1 = r[1].close;
   double ema = Ema(r, 1, InpCarryEmaN, total);
   int trend = c1 > ema ? 1 : (c1 < ema ? -1 : 0);
   double vf = RealizedVol(r, 1, InpCarryVolFast), vs = RealizedVol(r, 1, InpCarryVolSlow);
   double vr = vs > 0 ? vf / vs : 99.0;
   double atr = AtrSma(r, 1, InpCarryAtrN);

   ulong tk = FindPosition(sym, MagicCarry());
   if(tk != 0 && PositionSelectByTicket(tk))
     {
      int dir = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1;
      int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      // chandelier trail from the extremes since entry (only tightens)
      if(InpCarryTrailAtr > 0)
        {
         MqlRates h[];
         int n = CopyRates(sym, PERIOD_H1, (datetime)PositionGetInteger(POSITION_TIME), TimeCurrent(), h);
         double hh = -DBL_MAX, ll = DBL_MAX;
         for(int i = 0; i < n; i++) { hh = MathMax(hh, h[i].high); ll = MathMin(ll, h[i].low); }
         double sl = PositionGetDouble(POSITION_SL);
         double ns = NormalizeDouble(dir > 0 ? hh - InpCarryTrailAtr * atr : ll + InpCarryTrailAtr * atr, digits);
         if(n > 0 && ((dir > 0 && ns > sl) || (dir < 0 && (sl == 0 || ns < sl))))
           {
            double bid = SymbolInfoDouble(sym, SYMBOL_BID), ask = SymbolInfoDouble(sym, SYMBOL_ASK);
            if((dir > 0 && bid <= ns) || (dir < 0 && ask >= ns)) { if(!ClosePos(tk, sym, "CARRY trail beyond price")) return; tk = 0; }
            else
              {
               g_trade.SetExpertMagicNumber(MagicCarry());
               if(g_trade.PositionModify(tk, ns, 0.0)) Log("TRAIL", sym, DoubleToString(ns, digits));
              }
           }
        }
      if(tk != 0)
        {
         bool brk = dir > 0 ? trend <= 0 : trend >= 0;
         bool ex = brk || vr >= InpCarryVolExit || cd == 0 || cd != cd_prev || cd != dir;
         if(!ex) return;
         if(!ClosePos(tk, sym, "CARRY exit")) return;
        }
     }
   if(cd != 0 && trend == cd && vr < InpCarryVolEntry && atr > 0)
      OpenMarket(sym, cd, InpCarryStopAtr * atr, InpCarryRiskPct, MagicCarry(), "CRY");
  }

//==================================================================== init / events
void LoadSymbols(const string csv, D1State &arr[])
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
      arr[k].last_bar = iTime(s, PERIOD_D1, 0);   // never act on the bar already open at start-up
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
      if(s == "") continue;
      AddDate(g_extra_hol, DayStart(StringToTime(s)));
     }
  }

int OnInit()
  {
   g_tester = (bool)MQLInfoInteger(MQL_TESTER);
   g_trade.SetDeviationInPoints(InpDeviationPts);
   g_trade.SetMarginMode();
   string p = "TPEA_" + IntegerToString(InpMagicBase) + "_";
   g_gv_peak = p + "peak"; g_gv_halt = p + "halt"; g_gv_day = p + "day";
   g_gv_daybal = p + "daybal"; g_gv_gotobi_day = p + "gotobi_day";
   if(g_tester)
     {
      GlobalVariableDel(g_gv_peak); GlobalVariableDel(g_gv_halt); GlobalVariableDel(g_gv_day);
      GlobalVariableDel(g_gv_daybal); GlobalVariableDel(g_gv_gotobi_day);
     }
   ParseStages();
   LoadExtraHolidays();
   if(AccountInfoString(ACCOUNT_CURRENCY) != "JPY")
      Print("warning: account currency is ", AccountInfoString(ACCOUNT_CURRENCY), " - risk is still % of balance");
   if((ENUM_ACCOUNT_MARGIN_MODE)AccountInfoInteger(ACCOUNT_MARGIN_MODE) != ACCOUNT_MARGIN_MODE_RETAIL_HEDGING)
      Print("warning: account is not a hedging account; books sharing a symbol may net out");
   g_gotobi_sym = InpGotobiSymbol + InpSymbolSuffix;
   if(InpGotobiOn && !SymbolSelect(g_gotobi_sym, true)) { Print("gotobi symbol not available: ", g_gotobi_sym); g_gotobi_sym = ""; }
   if(InpMeanRevOn) LoadSymbols(InpMrSymbols, g_mr);
   if(InpCarryOn) LoadSymbols(InpCarrySymbols, g_carry);
   if(InpLogCsv)
     {
      g_csv = FileOpen("TitanPortfolioEA_" + IntegerToString(InpMagicBase) + (g_tester ? "_tester" : "") + ".csv",
                       FILE_WRITE | FILE_READ | FILE_CSV | FILE_ANSI | FILE_SHARE_READ, ',');
      if(g_csv != INVALID_HANDLE) FileSeek(g_csv, 0, SEEK_END);
     }
   // self-check of the clocks and the calendar
   datetime now = TimeCurrent();
   Log("INIT", "", StringFormat("server=%s jst=%s utc_offset=%d gotobi_today=%d balance=%.0f",
       TimeToString(now), TimeToString(ServerToJst(now)), -ServerToUtcHours(now),
       (int)IsGotobi(DayStart(ServerToJst(now))), AccountInfoDouble(ACCOUNT_BALANCE)));
   EventSetTimer(MathMax(InpTimerSec, 1));
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   if(g_csv != INVALID_HANDLE) FileClose(g_csv);
  }

void OnTimer()
  {
   UpdateAccountState();
   if(GvGet(g_gv_halt, 0.0) > 0.0) return;
   ProcessGotobi();
   for(int i = 0; i < ArraySize(g_mr); i++) ProcessMeanRev(g_mr[i]);
   for(int i = 0; i < ArraySize(g_carry); i++) ProcessCarry(g_carry[i]);
  }

void OnTick() { }
//+------------------------------------------------------------------+
