(function(){
  var results = [];

  // ====== 兼容多种容器 class ======
  // 问卷星常见容器选择器，按优先级排列
  // 注意：问卷星使用双下划线 data__items（不是 data_items）
  var containerSelectors = [
    '.data__items',          // 问卷星标准答题结果容器（双下划线）
    '.data_items',           // 兼容单下划线版本
    '.data-item',            // 单题容器
    '.fieldset',             // 表单域
    '.field',                // 字段
    '.question',             // 通用题目
    '.topic-item',           // 题目项
    'div[id^="divQ"]',       // divQ1, divQ2... (问卷星常见)
    'div[id^="div"]',        // div1, div2... (精确匹配脚本用)
    '.ui-controlgroup',      // jQuery UI 控件组
    '.topichtml',            // 题目HTML容器
    'li[data-type]',         // 带题型标记的列表项
    '.daan_item',            // 答案项
    '.result_item'           // 结果项
  ];

  var items = [];
  var usedSelectors = [];

  // 尝试每种选择器，合并去重
  containerSelectors.forEach(function(sel){
    try {
      var found = document.querySelectorAll(sel);
      if(found.length > 0){
        found.forEach(function(el){
          // 跳过分节标题块（如 "方框选词" 等段落标题）
          if(el.classList.contains('data__section') || el.classList.contains('data_section')) return;

          // 避免重复：检查是否已包含
          var alreadyAdded = items.some(function(existing){
            return existing === el || existing.contains(el) || el.contains(existing);
          });
          if(!alreadyAdded){
            items.push(el);
            if(usedSelectors.indexOf(sel) === -1) usedSelectors.push(sel);
          }
        });
      }
    } catch(e){}
  });

  // 如果上面都没找到，用更宽泛的策略
  if(items.length === 0){
    // 尝试找包含题目特征的 div
    var allDivs = document.querySelectorAll('div, li, section, article');
    allDivs.forEach(function(el){
      // 跳过分节标题
      if(el.classList.contains('data__section') || el.classList.contains('data_section')) return;

      var text = el.innerText || '';
      // 判断是否像题目：包含题号、有足够文本、不太长
      if(text.length > 5 && text.length < 2000 &&
         (text.match(/^\d+[\.、．]/) || text.match(/题目|答案|正确|得分/))){
        // 避免添加父容器
        var isChild = items.some(function(existing){
          return existing.contains(el);
        });
        var isParent = items.some(function(existing){
          return el.contains(existing);
        });
        if(!isChild && !isParent){
          items.push(el);
        }
      }
    });
  }

  console.log('[收集器] 找到 ' + items.length + ' 个候选容器 (选择器: ' + usedSelectors.join(', ') + ')');

  items.forEach(function(item, idx){
    var entry = {
      index: idx + 1,
      title: '',
      answer: '',
      type: '',
      options: [],
      _debug: ''
    };

    var fullText = (item.innerText || '').trim();

    // ====== 方框选词（Word Bank）特殊处理 ======
    // 检测是否为方框选词题组：共享词库 + 多个独立填空小题
    // 每道小题必须独立收集，因为词序不固定
    var isWordBankSection = false;
    var wordBankWords = [];

    // 检测特征1: 包含拖拽词库元素
    var dragWords = item.querySelectorAll(
      '.drag-item, .drag_item, .word-bank .word, .wordbank .word, ' +
      '[draggable="true"], .option-item, .bank-word, .word-item'
    );
    // 检测特征2: 文本中包含"方框选词"等关键词 + 多个填空行
    var hasWordBankKw = /方框选词|选词填空|word\s*bank|choose\s*words|fill\s*in\s*the\s*blanks?/i.test(fullText);
    var blankLineCount = (fullText.match(/_{2,}|____|（\s*）|\(\s*\)/g) || []).length;

    if (dragWords.length >= 3) {
      // 从拖拽元素中提取词库
      dragWords.forEach(function (el) {
        var w = el.innerText.trim();
        if (w && w.length > 0 && w.length < 50 && wordBankWords.indexOf(w) === -1) {
          wordBankWords.push(w);
        }
      });
      if (wordBankWords.length >= 2) isWordBankSection = true;
    } else if (hasWordBankKw && blankLineCount >= 2) {
      // 从文本中提取词库（通常在前几行，或在特定容器中）
      var bankEl = item.querySelector(
        '.word-bank, .wordbank, .word_box, .wordbox, ' +
        '.drag-box, .drag_box, .option-box, .option_box, ' +
        '.data__key, .data_key'
      );
      if (bankEl) {
        var bankText = bankEl.innerText.trim();
        bankText.split(/[\s,，、\n]+/).forEach(function (w) {
          w = w.trim();
          if (w && w.length > 0 && w.length < 50 && /^[a-zA-Z]/.test(w) && wordBankWords.indexOf(w) === -1) {
            wordBankWords.push(w);
          }
        });
      }
      // 如果没找到专门的词库容器，从全文前几行提取
      if (wordBankWords.length < 2) {
        var lines = fullText.split('\n');
        for (var li = 0; li < Math.min(lines.length, 5); li++) {
          var line = lines[li].trim();
          // 跳过题号行
          if (/^\d+[\.、．]/.test(line)) continue;
          // 提取英文词
          var words = line.match(/\b[a-zA-Z]{2,}\b/g);
          if (words && words.length >= 2) {
            words.forEach(function (w) {
              w = w.toLowerCase();
              if (wordBankWords.indexOf(w) === -1) wordBankWords.push(w);
            });
            break;
          }
        }
      }
      if (wordBankWords.length >= 2) isWordBankSection = true;
    }

    if (isWordBankSection && wordBankWords.length >= 2) {
      // ====== 方框选词：拆分为独立小题 ======
      var subQuestions = [];

      // 策略1: 找每个独立的填空容器（问卷星常见结构）
      var subContainers = item.querySelectorAll(
        '.sub-item, .sub_item, .question-item, .question_item, ' +
        '.topic-item, .topic_item, .data__items .data-item, ' +
        'div[id^="divQ"], div[id^="div"], .field, .fieldset'
      );

      // 如果没有找到子容器，尝试按行拆分
      if (subContainers.length < 2) {
        // 按文本行拆分：每行以数字开头 + 包含填空
        var lines = fullText.split('\n');
        var currentQ = null;
        lines.forEach(function (line) {
          line = line.trim();
          if (!line) return;
          // 新题目行：以数字开头 + 包含填空标记
          if (/^\d+[\.、．]/.test(line) && /_{2,}|____|（\s*）|\(\s*\)/.test(line)) {
            if (currentQ) subQuestions.push(currentQ);
            currentQ = { text: line, answer: '' };
          } else if (currentQ) {
            currentQ.text += ' ' + line;
          }
        });
        if (currentQ) subQuestions.push(currentQ);
      } else {
        // 从子容器中提取
        subContainers.forEach(function (sub) {
          var subText = (sub.innerText || '').trim();
          if (subText.length < 3) return;
          // 跳过词库容器本身
          if (sub.classList.contains('word-bank') || sub.classList.contains('wordbank') ||
              sub.classList.contains('word_box') || sub.classList.contains('wordbox') ||
              sub.classList.contains('drag-box') || sub.classList.contains('drag_box')) return;

          var subQ = { text: subText, answer: '' };

          // 提取答案：多种来源
          // 来源1: 删除线 + 括号 (如 "article(article)")
          var strikethroughEl = sub.querySelector(
            'span[style*="line-through"], s, strike, del'
          );
          if (strikethroughEl) {
            var nextT = '';
            var ns = strikethroughEl.nextSibling;
            while (ns && nextT.length < 100) {
              nextT += ns.textContent || ns.innerText || '';
              ns = ns.nextSibling;
            }
            var parenM = (strikethroughEl.innerText + nextT).match(/[\(（]([^\)）]+)[\)）]/);
            if (parenM) subQ.answer = parenM[1].trim();
          }

          // 来源2: 带颜色的正确答案
          if (!subQ.answer) {
            var colorEl = sub.querySelector(
              'span[style*="color:#8C"], span[style*="color:#CCC"], ' +
              'span[style*="color: #8C"], span[style*="color: #CCC"], ' +
              'span[style*="color:#8c"], span[style*="color:#ccc"], ' +
              'span[style*="color:green"], span[style*="color: green"], ' +
              '.text-green, .text-success, [style*="color:#4ecca3"]'
            );
            if (colorEl) {
              var ct = colorEl.innerText.trim().replace(/[\[\]()（）\s]/g, '');
              if (ct) subQ.answer = ct;
            }
          }

          // 来源3: .answer-ansys 中的正确答案
          if (!subQ.answer) {
            var ansEl = sub.querySelector('.answer-ansys');
            if (ansEl) {
              var at = ansEl.innerText.trim().replace(/^正确答案\s*[：:]\s*/, '').trim();
              if (at) subQ.answer = at;
            }
          }

          // 来源4: data__key
          if (!subQ.answer) {
            var keyEl = sub.querySelector('.data__key, .data_key');
            if (keyEl) {
              var kt = keyEl.innerText.trim()
                .replace(/^\(空\)/, '')
                .replace(/回答错误[^\n]*/g, '')
                .replace(/回答正确[^\n]*/g, '')
                .replace(/\+\d+分/g, '')
                .trim();
              var keyCorrectM = kt.match(/正确答案\s*[：:]\s*(.+)/);
              if (keyCorrectM) subQ.answer = keyCorrectM[1].trim();
              else if (kt && kt.length > 0 && !kt.match(/^[\d\s]+$/)) subQ.answer = kt;
            }
          }

          // 来源5: 【正确答案: xxx】模式
          if (!subQ.answer) {
            var htmlText = sub.innerHTML.replace(/<[^>]+>/g, '');
            var correctM = htmlText.match(/【正确答案\s*[：:]\s*([^】]+)】/);
            if (correctM) subQ.answer = correctM[1].trim();
          }

          subQuestions.push(subQ);
        });
      }

      // 为每道小题创建独立的 entry
      var subIdx = 0;
      subQuestions.forEach(function (sq) {
        subIdx++;
        var subTitle = sq.text
          .replace(/^\d+[\.、．]\s*/, '')
          .replace(/^[（\(]\d+分[）\)]\s*/, '')
          .replace(/\n/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        var subAnswer = (sq.answer || '').trim();

        // 清理标题中的答案信息
        subTitle = subTitle
          .replace(/\(空\)【[^】]*】/g, '___')
          .replace(/_{2,}/g, '___')
          .replace(/\b[a-zA-Z]+\s*[\(（][a-zA-Z]+[\)）]\s*/g, '')
          .replace(/\s+/g, ' ')
          .trim();

        if (subTitle.length < 3) return;

        // 过滤无关内容
        var isNoise = false;
        var tLower = subTitle.toLowerCase();
        var noiseKws = ['姓名', '班级', '学号', '年级', '学院', '专业', '手机', '电话', '邮箱'];
        for (var ni = 0; ni < noiseKws.length; ni++) {
          if (tLower.indexOf(noiseKws[ni]) >= 0) { isNoise = true; break; }
        }
        if (!isNoise) {
          var platformKws = ['问卷星提供技术支持', '提供技术支持', '保存报告', '免费创建问卷', 'wjx.cn'];
          for (var ni = 0; ni < platformKws.length; ni++) {
            if (tLower.indexOf(platformKws[ni]) >= 0) { isNoise = true; break; }
          }
        }
        if (isNoise) return;

        var subEntry = {
          index: idx + 1 + '.' + subIdx,
          title: subTitle,
          answer: subAnswer,
          type: 'wordbank',
          options: wordBankWords,
          _debug: '[wordbank-sub]'
        };
        results.push(subEntry);
      });

      // 方框选词组已处理完毕，跳过后续普通处理
      return;
    }

    // ====== 获取题目文本 ======
    // 注意：使用双下划线 class 名
    var titEl = item.querySelector(
      '.data__tit_cjd, .data_tit_cjd, .field-label, .topichtml, .topichtml label, label'
    );
    if(titEl){
      entry.title = titEl.innerText.trim()
        .replace(/^\d+[\.、．]\s*/, '')
        .replace(/^[（\(]\d+分[）\)]\s*/, '')
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ');
    }

    // 如果没找到标题元素，尝试从全文提取
    if(!entry.title && fullText){
      // 取第一行或前100字作为标题
      var firstLine = fullText.split('\n')[0].trim();
      entry.title = firstLine.substring(0, 150)
        .replace(/^\d+[\.、．]\s*/, '')
        .replace(/^[（\(]\d+分[）\)]\s*/, '');
    }

    // ====== 获取答案 (多种来源，优先级从高到低) ======

    // ---- 来源1: .answer-ansys 中的正确答案（格式A：词汇翻译） ----
    // 问卷星在答错时显示: .answer-ansys 中的 "正确答案: lantern"
    var ansAnsysEl = item.querySelector('.answer-ansys');
    if(ansAnsysEl){
      // 获取 answer-ansys 的全部文本，去掉"正确答案:"前缀
      var ansAnsysText = ansAnsysEl.innerText.trim()
        .replace(/^正确答案\s*[：:]\s*/, '')
        .trim();
      if(ansAnsysText && ansAnsysText.length > 0 && ansAnsysText.length < 500){
        entry.answer = ansAnsysText;
        entry._debug += '[answer-ansys]';
      }
    }

    // ---- 来源2: 从全文（去掉HTML标签）中提取 "【正确答案: XXX】"（格式B：填空题） ----
    // 问卷星在填空题中把答案嵌入标题，格式如: (空)【正确答案: regular】
    // HTML标签会打断正则匹配，所以先去掉标签再提取
    if(!entry.answer){
      var blockPlainText = item.innerHTML.replace(/<[^>]+>/g, '');
      var titleAnsMatches = [];
      var correctPattern = /【正确答案\s*[：:]\s*([^】]+)】/g;
      var m;
      while((m = correctPattern.exec(blockPlainText)) !== null){
        var ans = m[1].trim();
        if(ans) titleAnsMatches.push(ans);
      }
      if(titleAnsMatches.length > 0){
        entry.answer = titleAnsMatches.join(' ');
        entry._debug += '[title-correct-ans]';
      }
    }

    // ---- 来源3: .data__key 中的正确答案（双下划线） ----
    if(!entry.answer){
      var keyEl = item.querySelector('.data__key, .data_key');
      if(keyEl){
        var keyText = keyEl.innerText.trim();
        // 过滤掉 "(空)" 和纯数字/空 及 "回答错误" 等标记
        keyText = keyText
          .replace(/^\(空\)/, '')
          .replace(/回答错误[^\n]*/g, '')
          .replace(/回答正确[^\n]*/g, '')
          .replace(/\+\d+分/g, '')
          .trim();
        // 再次检查是否含有 正确答案: 标记
        var keyCorrectMatch = keyText.match(/正确答案\s*[：:]\s*(.+)/);
        if(keyCorrectMatch){
          entry.answer = keyCorrectMatch[1].trim();
          entry._debug += '[data__key-correct]';
        } else if(keyText && keyText.length > 0 && !keyText.match(/^[\d\s]+$/)){
          entry.answer = keyText;
          entry._debug += '[data__key]';
        }
      }
    }

    // ---- 来源4: .rightanswer / .correct / .answer 等常见正确答案类 ----
    if(!entry.answer){
      var ansSelectors = ['.rightanswer', '.correct', '.answer', '.daan', '.right_key',
                          '[class*="right"]', '[class*="correct"]', '[class*="answer"]'];
      ansSelectors.forEach(function(sel){
        if(entry.answer) return;
        try{
          var el = item.querySelector(sel);
          if(el){
            var t = el.innerText.trim();
            if(t && t.length > 1 && !t.match(/^[\d\s]+$/)){
              entry.answer = t;
              entry._debug += '[' + sel + ']';
            }
          }
        }catch(e){}
      });
    }

    // ---- 来源5: 带删除线 + 括号的答案 (格式: "用户答案(正确答案)") ----
    // 例如: "lanten(lantern)" → 正确答案是 "lantern"
    if(!entry.answer){
      var strikethroughEls = item.querySelectorAll(
        'span[style*="text-decoration:line-through"], ' +
        'span[style*="text-decoration: line-through"], ' +
        'span[style*="textDecoration:line-through"], ' +
        's, strike, del, ' +
        'span[style*="line-through"]'
      );

      strikethroughEls.forEach(function(stEl){
        if(entry.answer) return;
        // 获取删除线元素后面紧跟的文本/元素
        var nextText = '';
        var nextSibling = stEl.nextSibling;
        while(nextSibling && nextText.length < 200){
          if(nextSibling.nodeType === 3){ // 文本节点
            nextText += nextSibling.textContent;
          } else if(nextSibling.nodeType === 1){ // 元素节点
            nextText += nextSibling.innerText || nextSibling.textContent;
          }
          // 遇到新的题目或换行就停止
          if(nextText.match(/\n\d+[\.、．]/)) break;
          nextSibling = nextSibling.nextSibling;
        }

        // 从后续文本中提取括号里的答案: (lantern)
        var parenMatch = nextText.match(/^\s*[\(（]([^）\)]+[\)）])/);
        if(!parenMatch){
          // 也尝试从删除线元素自身文本+后续文本组合中提取
          var combined = stEl.innerText + nextText;
          parenMatch = combined.match(/[\(（]([^）\)]+)[\)）]/);
        }
        if(parenMatch){
          entry.answer = parenMatch[1].trim();
          entry._debug += '[strikethrough+parens]';
        }
      });
    }

    // ---- 来源6: 从全文中匹配 "用户答案(正确答案)" 模式 ----
    // 适用于删除线元素没有被正确识别的情况
    if(!entry.answer && fullText){
      // 模式: "n. 灯笼 lanten(lantern)" → 答案是 "lantern"
      // 匹配: 英文单词/短语后紧跟括号内的英文
      var allParenMatches = fullText.match(/\b([a-zA-Z][\w\s'-]*?)\s*[\(（]([a-zA-Z][\w\s,'"-]+)[\)）]/g);
      if(allParenMatches && allParenMatches.length > 0){
        // 取最后一个匹配（通常是正确答案）
        var lastMatch = allParenMatches[allParenMatches.length - 1];
        var m2 = lastMatch.match(/[\(（]([^\)）]+)[\)）]/);
        if(m2){
          entry.answer = m2[1].trim();
          entry._debug += '[fulltext-parens]';
        }
      }
    }

    // ---- 来源7: 带箭头的翻译答案 (如 "n. 灯笼 → lantern") ----
    if(!entry.answer){
      // 修复: 箭头后面可能有多个词，用 \s* 匹配空格
      var arrowPatterns = [
        /[→➜➡>＞]\s*(.+?)$/,           // 行尾
        /[→➜➡>＞]\s*(.+?)\n/m,         // 到换行
        /[→➜➡>＞]\s*(.+?)(?:\s{2,}|$)/m // 到多个空格或行尾
      ];
      arrowPatterns.forEach(function(pattern){
        if(entry.answer) return;
        var arrowMatch = fullText.match(pattern);
        if(arrowMatch){
          var ans = arrowMatch[1].trim()
            .replace(/[\(（].*?[\)）]/g, '') // 移除括号内容
            .replace(/^\s*[：:]\s*/, '')
            .trim();
          if(ans && ans.length > 0 && ans.length < 200){
            entry.answer = ans;
            entry._debug += '[arrow]';
          }
        }
      });
    }

    // ---- 来源8: 带下划线的填空答案 ----
    if(!entry.answer){
      var underlineSpan = item.querySelector(
        'span[style*="text-decoration:underline"], ' +
        'span[style*="text-decoration: line-through"], ' +
        'span[style*="textDecoration:underline"], ' +
        'u, .underline'
      );
      if(underlineSpan){
        var ut = underlineSpan.innerText.trim();
        // 排除标题中包含的下划线
        if(ut && ut.length > 0 && ut.length < 100 && ut !== entry.title){
          entry.answer = ut;
          entry._debug += '[underline]';
        }
      }
    }

    // ---- 来源9: 带颜色的答案标记 ----
    if(!entry.answer){
      var colorSpan = item.querySelector(
        'span[style*="color:#8C"], span[style*="color:#CCC"], ' +
        'span[style*="color: #8C"], span[style*="color: #CCC"], ' +
        'span[style*="color:#8c"], span[style*="color:#ccc"], ' +
        'span[style*="color:green"], span[style*="color: green"], ' +
        '.text-green, .text-success, [style*="color:#4ecca3"]'
      );
      if(colorSpan){
        var ct = colorSpan.innerText.trim()
          .replace(/[\[\]()（）\s]/g, '').trim();
        if(ct && ct.length > 0) entry.answer = ct;
        entry._debug += '[color]';
      }
    }

    // ---- 来源10: 单选/多选 已选中 ----
    var checked = item.querySelectorAll('input:checked');
    if(checked.length > 0 && !entry.answer){
      var vals = [];
      checked.forEach(function(c){
        var lbl = c.closest('.label, label') || c.parentElement;
        if(lbl) vals.push(lbl.innerText.trim());
      });
      entry.answer = vals.join(', ');
      entry._debug += '[checked]';
    }

    // ---- 来源11: textarea 已有内容 ----
    if(!entry.answer){
      var ta = item.querySelector('textarea');
      if(ta && ta.value) entry.answer = ta.value;
      entry._debug += '[textarea]';
    }

    // ---- 来源12: select 已选 ----
    if(!entry.answer){
      var sel = item.querySelector('select');
      if(sel && sel.selectedIndex >= 0){
        entry.answer = sel.options[sel.selectedIndex].text;
        entry._debug += '[select]';
      }
    }

    // ====== 获取选项 ======
    var optLabels = item.querySelectorAll(
      '.label, .ui-controlgroup label, .ui-controlgroup span'
    );
    optLabels.forEach(function(lbl){
      var t = lbl.innerText.trim();
      if(t && t !== entry.title && t !== entry.answer &&
         entry.options.indexOf(t) === -1){
        entry.options.push(t);
      }
    });

    // ====== 判断题型 ======
    // 匹配题检测（拖拽匹配、连线匹配）
    var isMatching = item.classList.contains('drag') ||
        item.classList.contains('matching') ||
        item.classList.contains('connect') ||
        item.querySelector('.drag-item, .drag_item, .match-item, .match_item, .connect-item, .connect_item') !== null ||
        (item.querySelector('[draggable="true"]') !== null && item.querySelector('.drop-zone, .drop_zone, .target, .match-target') !== null);
    if(isMatching) entry.type = 'matching';
    else if(item.querySelector('input[type="radio"]')) entry.type = 'radio';
    else if(item.querySelector('input[type="checkbox"]')) entry.type = 'checkbox';
    else if(item.querySelector('textarea')) entry.type = 'textarea';
    else if(item.querySelector('select')) entry.type = 'select';
    else if(entry.answer) entry.type = 'fill';
    else entry.type = 'unknown';

    // ====== 匹配题专用提取 ======
    // 如果检测为匹配题但还没有答案，尝试提取配对关系
    if(entry.type === 'matching' && !entry.answer){
      var pairs = [];
      // 策略1: 找 .data__key 或 .answer-ansys 中的配对信息
      var matchSrc = item.querySelector('.data__key, .data_key, .answer-ansys');
      if(matchSrc){
        var matchText = matchSrc.innerText.trim();
        // 匹配格式: "1-A, 2-B, 3-C" 或 "1→A, 2→B" 或 "1.A 2.B"
        var pairPatterns = [
          /(\d+)\s*[-–—→➜➡:>＞]\s*([A-Za-z])/g,
          /(\d+)\s*[\.、．]\s*([A-Za-z])/g,
          /([A-Za-z])\s*[-–—→➜➡:>＞]\s*(\d+)/g
        ];
        pairPatterns.forEach(function(pp){
          var pm;
          while((pm = pp.exec(matchText)) !== null){
            var k = pm[1], v = pm[2];
            if(/\d/.test(k)){
              pairs.push({term: k, def: v});
            } else {
              pairs.push({term: v, def: k});
            }
          }
        });
      }

      // 策略2: 从拖拽结果 DOM 中提取
      if(pairs.length === 0){
        var dropZones = item.querySelectorAll('.drop-zone, .drop_zone, .target, .match-target, [data-answer]');
        dropZones.forEach(function(zone){
          var term = zone.querySelector('.drag-item, .drag_item, .match-item, .match_item');
          var def = zone.getAttribute('data-answer') || zone.getAttribute('data-correct');
          if(term && def){
            pairs.push({term: term.innerText.trim(), def: def.trim()});
          }
        });
      }

      // 策略3: 从删除线+括号模式提取 (如 "①term A(def)")
      if(pairs.length === 0 && fullText){
        var lines = fullText.split('\n');
        lines.forEach(function(line){
          var m = line.match(/[①②③④⑤⑥⑦⑧⑨⑩\d]+[\.、．\s]*([^\s→]+)\s*[→➜➡:>＞\-]\s*([A-Za-z])/);
          if(m) pairs.push({term: m[1].trim(), def: m[2].trim()});
        });
      }

      if(pairs.length > 0){
        entry.answer = pairs.map(function(p){ return p.term + '→' + p.def; }).join(', ');
        entry.matchPairs = pairs;
        entry._debug += '[matching-pairs]';
      }
    }

    // ====== 清理标题中的答案信息 ======
    // 移除标题中的 "(空)【正确答案: XXX】" 部分，保留纯题目文本
    if(entry.title){
      entry.title = entry.title
        .replace(/\(空\)【[^】]*】/g, '___')  // 将答案占位替换为 ___
        .replace(/\b[a-zA-Z]+\s*[\(（][a-zA-Z]+[\)）]\s*/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    // ====== 清理答案 ======
    if(entry.answer){
      entry.answer = entry.answer
        .replace(/^[\s：:]+/, '')
        .replace(/[\s：:]+$/, '')
        .replace(/\n/g, ' ')
        .replace(/\u00a0/g, ' ')
        .trim();
    }

    // 只保留有内容的题目（且跳过没有题号/标题的分节块）
    if((entry.title || entry.answer) && entry.title.length > 2){
      // ====== 过滤无关内容 ======
      var isNoise=false;
      var tLower=(entry.title+'').toLowerCase();
      var aLower=(entry.answer||'').toLowerCase();

      // 个人信息关键词
      var noiseKws=['姓名','班级','学号','年级','学院','专业','手机','电话','邮箱','座位','组别','姓氏'];
      for(var ni=0;ni<noiseKws.length;ni++){
        var kw=noiseKws[ni];
        if(tLower.indexOf(kw)>=0 || aLower.indexOf(kw)>=0){
          // 排除正常题目中提到这些词的情况（如"手机号码用英语怎么说"）
          // 只过滤以这些词开头的（通常是表头字段）
          var trimmed=(entry.title||'').replace(/^\d+[\.、．\s]*/,'').trim();
          if(trimmed.indexOf(kw)>=0 && trimmed.indexOf(kw)<6){isNoise=true;break;}
        }
      }

      // 平台信息关键词
      if(!isNoise){
        var platformKws=['问卷星提供技术支持','提供技术支持','保存报告','仅看错题',
          '没有回答错误','回答错误的题目','查看答卷','继续答卷','重新答题',
          '返回首页','提交答卷','答题时间','答题用时','提交时间','ip地址',
          'www.wjx.cn','wjx.cn','免费创建问卷'];
        for(var ni=0;ni<platformKws.length;ni++){
          if(tLower.indexOf(platformKws[ni])>=0 || aLower.indexOf(platformKws[ni])>=0){
            isNoise=true;break;
          }
        }
      }

      // 纯数字/纯标点
      if(!isNoise){
        var tClean=entry.title.replace(/[\s\.\-]/g,'');
        if(/^\d+$/.test(tClean)) isNoise=true;
      }

      // 标题太长（>500字符）也跳过
      if(!isNoise && entry.title.length>500) isNoise=true;

      if(!isNoise) results.push(entry);
    }
  });

  // ====== 输出结果 ======
  var json = JSON.stringify(results, null, 2);

  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(json).then(function(){
      console.log(
        '%c✅ 已收集 ' + results.length + ' 道题，已复制到剪贴板！',
        'color:#4ecca3;font-size:16px;font-weight:bold'
      );
    }).catch(function(){
      console.log('%c✅ 已收集 ' + results.length + ' 道题，请手动复制下方 JSON：',
        'color:#4ecca3;font-size:16px;font-weight:bold');
      console.log(json);
    });
  } else {
    console.log(json);
  }

  // 调试信息
  if(results.length > 0){
    console.log('[收集器] 调试信息:');
    results.forEach(function(r){
      console.log('  #' + r.index + ' [' + r._debug + '] ' +
                  r.title.substring(0,40) + ' → ' + r.answer);
    });
  } else {
    console.warn('[收集器] ⚠️ 未找到任何题目！请检查：');
    console.warn('  1. 是否在正确的答题结果页面运行？');
    console.warn('  2. 页面是否已完全加载？');
    console.warn('  3. 请在控制台运行: document.querySelectorAll(".data__items").length');
    console.warn('  4. 或运行: document.querySelectorAll("div[id^=div]").length');
    console.warn('  5. 将结果告诉我，我帮你调整选择器');
  }

  // 页面浮层提示
  var tip = document.createElement('div');
  tip.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);' +
    'background:#4ecca3;color:#000;padding:10px 22px;border-radius:8px;' +
    'font-size:15px;font-weight:bold;z-index:99999;box-shadow:0 4px 20px rgba(0,0,0,.4);';
  tip.textContent = '✅ 已收集 ' + results.length + ' 道题，已复制到剪贴板！';
  document.body.appendChild(tip);
  setTimeout(function(){ tip.remove(); }, 3000);

  return results;
})();
