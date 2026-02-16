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
	search(pattern, additions = [], { preFightAdvancesMax, postDashAdvancesMax, postWalkAdvancesMax, } = {}, start = 0, len = CYCLE_LEN) {
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

		for (let preFightAdvances = 0; preFightAdvances <= preFightAdvancesMax; preFightAdvances++) {
			//走った場合に乱数を進める最適な量を探す
			const postDash = {
				advances: 0,
				jumpChance: 0,
				glideChance: 0,
			}
			for (let postDashAdvances = 0; postDashAdvances <= postDashAdvancesMax; postDashAdvances++) {
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
			for (let postWalkAdvances = 0; postWalkAdvances <= postWalkAdvancesMax; postWalkAdvances++) {
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
	//ボス順の初期配列を生成しシャッフル
	_buildOrder(idx, timer, timerMask, shuffleLen, totalLen) {
		const offset = timer & timerMask;
		const bossOrder = Uint8Array.from({length:totalLen}, (_, i)=>
			i < shuffleLen
			? (offset + i) % shuffleLen	//シャッフル対象を回転させて初期化
			: i	//固定ボスを末尾に配置
		);
		//シャッフル
		for (let i = 0; i < shuffleLen; i++) {
			const r = randiAt(++idx, shuffleLen);
			[bossOrder[i], bossOrder[r]] = [bossOrder[r], bossOrder[i]];
		}
		return bossOrder;
	},

	//通常の格闘王への道
	arenaBosses: [
		"ワドルディ", "中ボス2", "中ボス1", "バトルウィンドウズ",
		"2連主砲", "魔人ワムバムロック", "デデデ大王", "ダイナブレイド",
		"ファッティホエール", "ガメレオアーム", "ヘビーロブスター", "クラッコ",
		"ロロロ&ラララ", "メタナイト", "ギャラクティック・ノヴァ", "リアクター",
		"ツインウッズ", "ウィスピーウッズ",
		"マルク",	//固定
	],
	arenaBossOrder(idx, timer) {
		return this._buildOrder(idx, timer, 0xF, 18, 19);
	},

	//真・格闘王への道
	trueArenaBosses: [
		"中ボス", "カブーラー", "クラッコJr.リベンジ",
		"クラッコリベンジ", "ロロロ&ラララリベンジ", "ウイスピーウッズリベンジ",
		"マスクドデデデ", "ワムバムジュエル", "ギャラクティックナイト", "マルクソウル",	//固定
	],
	trueArenaBossOrder(idx, timer) {
		return this._buildOrder(idx, timer, 0x3, 6, 10);
	},

	//モード別設定
	_config(isTrueArena) {
		return isTrueArena
			? { bosses: this.trueArenaBosses, orderFn: (i, t) => this.trueArenaBossOrder(i, t), shuffleLen: 6, timerMax: 3 }
			: { bosses: this.arenaBosses, orderFn: (i, t) => this.arenaBossOrder(i, t), shuffleLen: 18, timerMax: 15 };
	},

	/**
	 * 一戦目のボスと乱数候補からボス順を予測
	 * @param {number[]} candidates コルクボード検索から得た乱数位置の配列
	 * @param {number} firstBoss 一戦目のボスのインデックス
	 * @param {boolean} isTrueArena 真・格闘王への道かどうか
	 */
	predict(candidates, firstBoss, isTrueArena) {
		const { orderFn, shuffleLen, timerMax } = this._config(isTrueArena);

		const results = [];
		for (const idx of candidates) {
			//コルクボード結果の次の乱数位置からシャッフルが始まる
			const order0 = orderFn(idx, 0);
			//timer=0での一戦目との差からtimerを逆算
			const timer = (firstBoss - order0[0] + shuffleLen) % shuffleLen;
			if (timer > timerMax) continue;
			//timerオフセットを適用して実際のボス順を計算
			const order = Array.from(order0, (b, i) => i < shuffleLen ? (b + timer) % shuffleLen : b);
			results.push({ idx, timer, order });
		}
		return results;
	}
}

export { Star, Corkboard, HeavyLobster, FattyWhale, Arena, initialSeed, rngAt, randi, randiAt, rngIdxOf };