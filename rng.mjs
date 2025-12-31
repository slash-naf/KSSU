//ソフトリセットした時刻から初期シードを計算
const initialSeed = (minutes, seconds) => (minutes & 0xF) << 8 | seconds;

//乱数生成器
const CYCLE_LEN = 0x1000;	//周期は2の12乗
const SEED_MASK = 0xFFF;
const rngCycle = new Uint16Array(CYCLE_LEN);
for (let i = 0, x = 0; i < CYCLE_LEN; i++, x = x * 61 + 1401 & SEED_MASK) {	//乱数は線形合同法で、生成式は X[n+1] = (61 × X[n] + 1401) mod 2^12
	rngCycle[i] = x;
}
const rngAt = i => rngCycle[i & SEED_MASK];	//指定した位置の乱数値を取得
const randi = (seed, max) => seed * max >> 12;	//乱数値を基に、指定した最大値未満の整数を取得
const randiAt = (i, max) => randi(rngAt(i), max);	//指定した位置の乱数値を基に、指定した最大値未満の整数を取得

//値から位置を取得
function rngIdxOf(s) {
	let r = 0, a = 61, b = 1401, k = 1;
	while (k < 0x1000) {
		if (s & 1) {
			s = a * s + b;
			r -= k;
		}
		b = (a + 1) * b >>> 1;
		a = a * a & 0xFFF;
		s >>>= 1;
		k <<= 1;
	}
	return r & 0xFFF;
}

/** カービィの着地や衝突による星の向きの乱数 */
const Star = {
	names: ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'],
	at: i => randiAt(i, 9) & 7,	//各向きの確率は均等ではなく、上が9分の2の確率
}

//コルクボードの曲から乱数を予測
const Corkboard = {
	names: ['裏コルクボード', 'コルクボード'],
	at: i => randiAt(i, 2),
	/**
	 * コルクボードの曲のパターンに対応する乱数を検索
	 * @param {Array} pattern 1:裏コルクボード、0:コルクボード、-1:ワイルドカード
	 * @returns {Array} 乱数の位置の配列
	 */
	search(pattern) {
		const rslt = [];
		for (let i = 0; i < CYCLE_LEN; i++) {
			if (pattern.every((x, advances) => -1 === x || this.at(i + advances * 2) === x)) {	//タイトル画面とコルクボードの往復で乱数が2進む
				rslt.push(i);
			}
		}
		return rslt;
	}
}

const FattyWhale = {
	rollsAt: i => 0b01001101 >> (rngAt(i - 3) & 4) + randiAt(i, 4) & 1,
}

//ヘビーロブスター戦で星の向きから乱数を予測し、乱数をいくつ手動で進めれば目的の乱数を引けるか計算
const HeavyLobster = {
	preFightAdvanceMax: 31,
	postDashAdvanceMax: 7,
	postWalkAdvanceMax: 11,

	isDash: i => rngAt(i) >> 10,
	isWalk: i => !(rngAt(i) >> 10),
	isGlide: i => rngAt(i) >> 10,
	isJump: i => !(rngAt(i) >> 10),

	//星の向きから乱数を推測
	search(pattern, additions = []) {
		let advances = 0;

		let map = new Map();
		const add = (i, n) => {
			let d = map.get(i);
			map.set(i, (d ?? 0) + n);
		}

		let addition = 0;
		const offsets = [0, 64, 127, 160, 179, 555, 584, 598].map((v, i) => {
			addition += additions[i] ?? 0;
			return v + addition;
		});
		const match = (i, n) => pattern[i] < 0 || pattern[i] == Star.at(advances + offsets[i] + n);

		for (; advances < 0x1000; advances++) {
			if (match(0, 0) && match(3, 0)) {
				let b = match(1, 2);
				if (match(2, 0) && match(4, 0)) {
					if (match(1, 0)) {
						add(advances, 1);
					}
					if (b) {
						add(advances, 2);
					}
				}
				if (b && match(2, 2) && match(4, 2)) {
					add(advances + 2 & 0xFFF, 2);
					add(advances | 0x2000, 2);
					add(advances, 1);
				}
			}
		}

		let rslt = [];
		rslt.cntSum = 0;
		for (const [advances, cnt] of map.entries()) {
			let n = advances >> 12;
			rslt.push({
				dashWalkIdx: (advances + offsets[5] + n) & 0xFFF,
				postDashIdx: (advances + offsets[6]) & 0xFFF,
				postWalkIdx: (advances + offsets[7] + n) & 0xFFF,
				cnt: cnt
			});
			rslt.cntSum += cnt;
		}

		return rslt;
	},
	//乱数を進める最適な量を計算
	calc(candidates) {
		//飛ぶかの判定までにさらに進める乱数の最適な量を探す
		const maxJumpCntFromPreFightAdvance = preFightAdvance => {
			let rslt = {
				dashJumpCnt: 0,
				postDashAdvance: 0,
				walkJumpCnt: 0,
				postWalkAdvance: 0,
			};
			for (let i = 0, leDash, leWalk; (leDash = i <= this.postDashAdvanceMax) | (leWalk = i <= this.postWalkAdvanceMax); i++) {
				//走った場合と歩いた場合のジャンプする確率を調べる
				let dashJumpCnt = 0;
				let walkJumpCnt = 0;
				for (let x of candidates) {
					if (this.isDash(x.dashWalkIdx + preFightAdvance)) {	//走るなら
						if (leDash && this.isJump(x.postDashIdx + preFightAdvance + i)) {
							dashJumpCnt += x.cnt;
						}
					} else {	//歩くなら
						if (leWalk && this.isJump(x.postWalkIdx + preFightAdvance + i)) {
							walkJumpCnt += x.cnt;
						}
					}
				}
				//より高確率なら更新
				if (dashJumpCnt > rslt.dashJumpCnt) {
					rslt.dashJumpCnt = dashJumpCnt;
					rslt.postDashAdvance = i;
				}
				if (walkJumpCnt > rslt.walkJumpCnt) {
					rslt.walkJumpCnt = walkJumpCnt;
					rslt.postWalkAdvance = i;
				}
			}
			return rslt;
		}

		//乱数を進める最適な量を探す
		let rslt = {
			cnt: candidates.cntSum,

			dashJumpCnt: 0,
			postDashAdvance: 0,
			walkJumpCnt: 0,
			postWalkAdvance: 0,

			preFightAdvance: 0,
			jumpCnt: 0,
			dashCnt: 0,
			dashGlideCnt: 0,

			walkCnt: 0,
			walkGlideCnt: 0,
			glideCnt: 0,
		};
		for (let preFightAdvance = 0; preFightAdvance <= this.preFightAdvanceMax; preFightAdvance++) {
			let t = maxJumpCntFromPreFightAdvance(preFightAdvance);

			//飛ぶ確率、走って飛ぶ確率、走ったら進める量の少なさ、歩いたら進める量の少なさ、走って滑走する確率の順の条件で更新
			let jumpCnt = t.dashJumpCnt + t.walkJumpCnt;
			let dashCnt = candidates.reduce((prev, x) => this.isDash(x.dashWalkIdx + preFightAdvance) ? prev + x.cnt : prev, 0);
			let dashGlideCnt = dashCnt - t.dashJumpCnt;
			if (0 < (
				jumpCnt - rslt.jumpCnt ||
				t.dashJumpCnt - rslt.dashJumpCnt ||
				rslt.postDashAdvance - t.postDashAdvance ||
				rslt.postWalkAdvance - t.postWalkAdvance ||
				dashGlideCnt - rslt.dashGlideCnt
			)) {
				rslt.preFightAdvance = preFightAdvance;
				rslt.jumpCnt = jumpCnt;
				rslt.dashCnt = dashCnt;
				rslt.dashGlideCnt = dashGlideCnt;

				rslt.dashJumpCnt = t.dashJumpCnt;
				rslt.postDashAdvance = t.postDashAdvance;
				rslt.walkJumpCnt = t.walkJumpCnt;
				rslt.postWalkAdvance = t.postWalkAdvance;
			}
		}

		//他の確率
		rslt.walkCnt = rslt.cnt - rslt.dashCnt;
		rslt.walkGlideCnt = rslt.walkCnt - rslt.walkJumpCnt;
		rslt.glideCnt = rslt.cnt - rslt.jumpCnt;

		return rslt;
	}
}

//格闘王への道
const Arena = {
	normal_arena_bosses: [
		"ワドルディ",
		"中ボス2",
		"中ボス1",
		"バトルウィンドウズ",
		"2連主砲",
		"魔人ワムバムロック",
		"デデデ大王",
		"ダイナブレイド",
		"ファッティホエール",
		"ガメレオアーム",
		"ヘビーロブスター",
		"クラッコ",
		"ロロロ&ラララ",
		"メタナイト",
		"ギャラクティック・ノヴァ",
		"リアクター",
		"ツインウッズ",
		"ウィスピーウッズ",
		"マルク",
	],
	bossOrder(idx, timer) {
		//初期化 (0..17 の値を回転させて埋める)
		const bossOrder = new Uint8Array(19);
		let offset = timer & 0xF;	//乱数タイマーから開始オフセットを決定 (0-15)
		const limit = 18;	//マルクは固定
		for (let i = 0; i < limit; i++) {
			if (offset >= limit) {
				offset = 0;
			}
			bossOrder[i] = offset;
			offset++;
		}
		bossOrder[18] = 18;

		//シャッフル (0..17 の範囲のみ)
		//各要素について、0..limit-1 のランダムな位置と交換
		for (let i = 0; i < limit; i++) {
			const r = randiAt(idx++, limit);
			[bossOrder[i], bossOrder[r]] = [bossOrder[r], bossOrder[i]];
		}

		return bossOrder;
	}
}

export { Star, Corkboard, HeavyLobster, FattyWhale, Arena, initialSeed, rngAt, randi, randiAt, rngIdxOf };