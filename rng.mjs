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
	isDash: i => randiAt(i, 4) !== 0,
	isWalk: i => randiAt(i, 4) === 0,
	isGlide: i => randiAt(i, 4) !== 0,
	isJump: i => randiAt(i, 4) === 0,

	/**
	 * 星の向きから乱数を推測
	 * @param {Array} pattern 0～7:星の向き, -1:ワイルドカード
	 * @param {Array} additions 各タイミングでの乱数の想定とのズレの配列
	 * @returns {Array} 乱数の位置と出現確率の配列 [{dashOrWalkIdx, afterDashIdx, afterWalkIdx, chance}]
	 */
	search(pattern, additions = [], { preFightAdvanceMax = 31, postDashAdvanceMax = 7, postWalkAdvanceMax = 11, } = {}, start = 0, len = CYCLE_LEN) {
		//0～4:星の向き、5:走るか、6:走った後、7:歩いた後
		/*
			乱数タイマーごとの乱数位置のパターン
			[0, 66, 129, 160, 181, 557, 586, 600],
			[0, 66, 129, 160, 181, 557, 586, 600],
			[0, 66, 129, 160, 181, 557, 584, 600],
			[0, 66, 129, 160, 181, 557, 584, 600],
			[0, 66, 129, 160, 181, 555, 584, 598],
			[0, 66, 127, 160, 179, 555, 584, 598],
			[0, 66, 127, 160, 179, 555, 584, 598],
			[0, 64, 127, 160, 179, 555, 584, 598],
		*/
		let addition = 0;
		const offsets = [0, 64, 127, 160, 179, 555, 584, 598].map((v, i) => {
			addition += additions[i] ?? 0;
			return v + addition;
		});
		console.log(offsets)
		//乱数パターンごとに確率を記録
		const candidates = [];
		const push = (chance, a, n = 0) => {
			candidates.push({
				dashOrWalkIdx: (start + a + offsets[5] + n) & SEED_MASK,
				afterDashIdx: (start + a + offsets[6]) & SEED_MASK,
				afterWalkIdx: (start + a + offsets[7] + n) & SEED_MASK,
				chance: chance
			});
		}
		const match = (i, a) => pattern[i] === -1 || pattern[i] === Star.at(start + a + offsets[i]);
		for (let a = 0; a < len; a++) {
			if (match(0, a) && match(3, a)) { //0と3は全パターン共通
				const b = match(1, a + 2);
				if (match(2, a) && match(4, a)) { //2と4は同じ分布
					if (match(1, a)) {
						push(1, a);
					}
					if (b) {
						push(2, a);
					}
				}
				if (b && match(2, a + 2) && match(4, a + 2)) {
					push(2, a + 2);
					push(2, a, 2);
					push(1, a);
				}
			}
		}

		//乱数を進める最適な量を探す
		const preFight = {
			advances: 0,
			postDash: {
				advances: 0,
				jumpChance: 0,
				glideChance: 0,
			},
			postWalk: {
				advances: 0,
				jumpChance: 0,
				glideChance: 0,
			},
		};

		for (let preFightAdvances = 0; preFightAdvances <= preFightAdvanceMax; preFightAdvances++) {
			//走った場合に乱数を進める最適な量を探す
			const postDash = {
				advances: 0,
				jumpChance: 0,
				glideChance: 0,
			}
			for (let postDashAdvances = 0; postDashAdvances <= postDashAdvanceMax; postDashAdvances++) {
				//走った場合の飛ぶ確率と滑る確率を計算
				let jumpChance = 0;
				let glideChance = 0;
				for (const x of candidates) {
					if (this.isDash(x.dashOrWalkIdx + preFightAdvances)) {
						if (this.isJump(x.afterDashIdx + preFightAdvances + postDashAdvances)) {
							jumpChance += x.chance;
						} else {
							glideChance += x.chance;
						}
					}
				}
				//より飛ぶ確率が高ければ更新
				if (jumpChance > postDash.jumpChance) {
					postDash.advances = postDashAdvances;
					postDash.jumpChance = jumpChance;
					postDash.glideChance = glideChance;
				}
			}

			//歩いた場合に乱数を進める最適な量を探す
			const postWalk = {
				advances: 0,
				jumpChance: 0,
				glideChance: 0,
			};
			for (let postWalkAdvances = 0; postWalkAdvances <= postWalkAdvanceMax; postWalkAdvances++) {
				//歩いた場合の飛ぶ確率と滑る確率を計算
				let jumpChance = 0;
				let glideChance = 0;
				for (const x of candidates) {
					if (this.isWalk(x.dashOrWalkIdx + preFightAdvances)) {
						if (this.isJump(x.afterWalkIdx + preFightAdvances + postWalkAdvances)) {
							jumpChance += x.chance;
						} else {
							glideChance += x.chance;
						}
					}
				}
				//より飛ぶ確率が高ければ更新
				if (jumpChance > postWalk.jumpChance) {
					postWalk.advances = postWalkAdvances;
					postWalk.jumpChance = jumpChance;
					postWalk.glideChance = glideChance;
				}
			}

			//更新
			if (0 < (
				(postDash.jumpChance + postWalk.jumpChance) - (preFight.postDash.jumpChance + preFight.postWalk.jumpChance) ||
				postDash.jumpChance - preFight.postDash.jumpChance ||
				postWalk.jumpChance - preFight.postWalk.jumpChance ||
				postDash.glideChance - preFight.postDash.glideChance ||
				preFight.postDash.advances - postDash.advances ||
				preFight.postWalk.advances - postWalk.advances
			)) {
				preFight.advances = preFightAdvances;
				preFight.postDash = postDash;
				preFight.postWalk = postWalk;
			}
		}

		return preFight;
	}
}

//格闘王への道
const Arena = {
	//通常の格闘王への道の並び順
	arenaBosses: [
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
	arenaBossOrder(idx, timer) {
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

		//マルク以外のシャッフル
		//各要素について、0..17 のランダムな位置と交換
		for (let i = 0; i < limit; i++) {
			const r = randiAt(idx++, limit);
			[bossOrder[i], bossOrder[r]] = [bossOrder[r], bossOrder[i]];
		}

		return bossOrder;
	},
	//真・格闘王への道の並び順
	trueArenaBosses: [
		"中ボス",
		"カブーラー",
		"クラッコJr.リベンジ",
		"クラッコリベンジ",
		"ロロロ&ラララリベンジ",
		"ウイスピーウッズリベンジ",
		"マスクドデデデ",
		"ワムバムジュエル",
		"ギャラクティックナイト",
		"マルクソウル",
	],
	trueArenaBossOrder(idx, timer) {
		//初期化 (0..5 の値を回転させて埋める)
		const bossOrder = new Uint8Array(10);
		let offset = timer & 0x3;	//乱数タイマーから開始オフセットを決定 (0-3)
		const limit = 6;	//四天王は固定
		for (let i = 0; i < limit; i++) {
			if (offset >= limit) {
				offset = 0;
			}
			bossOrder[i] = offset;
			offset++;
		}
		bossOrder[6] = 6;
		bossOrder[7] = 7;
		bossOrder[8] = 8;
		bossOrder[9] = 9;

		//前半6ボスのシャッフル
		//各要素について、0..5 のランダムな位置と交換
		for (let i = 0; i < limit; i++) {
			const r = randiAt(idx++, limit);
			[bossOrder[i], bossOrder[r]] = [bossOrder[r], bossOrder[i]];
		}

		return bossOrder;
	}
}

export { Star, Corkboard, HeavyLobster, FattyWhale, Arena, initialSeed, rngAt, randi, randiAt, rngIdxOf };