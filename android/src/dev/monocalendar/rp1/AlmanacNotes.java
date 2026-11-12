package dev.monocalendar.rp1;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 黄历、节日和节气释义；中文审校版，2026-11-07。
 *
 * 范围：114个日宜忌原始键、12个建除值日、24节气、28个现有节日、12个通用概念。
 * 114个键来自6tail/lunar-javascript v1.7.8所有月干支×日干支组合的日宜、日忌并集。
 * 这是对指定上游版本和用户所列节日范围的完整释义整理。
 * 中文审校以当前工程中的释义为基础；保留原有词条、别名和来源注释。
 * 释义中的日期、年份统一使用中文数字；农历日期保留“正月初一”“腊月廿三”等惯用写法。
 *
 * 正文为根据资料重新编写的简明中文；来源、口径差异和编辑判断留在逐条注释中。
 * 黄历部分解释传统民俗术语，不把宜忌、冲煞解释为客观因果或个人命运结论。
 * 建除只释名：不另加一套按“建日/破日”等推导的宜忌，避免与现有6tail结果矛盾。
 * 节气物候是传统时令描述，受地区影响；实际日期、时刻仍由现有历法数据提供。
 * 节日采用本应用所列现代日期口径，不包含逐年法定放假或调休数据。
 *
 * 重点核对：
 * 1. 解除兼有禳灾除秽及通书中的清洗宅舍义，不能只写“打扫卫生”。
 * 2. 经络取纺织义；分居取分家义；出火指香火迁动。
 * 3. 归岫有通书口径差异，采用寄梁后安放固定梁木的营造义，注释保留另一说；
 *    行丧也有治丧/吊唁两种口径，正文并列，避免将其中一种误称为唯一解释。
 * 4. 纳采的古礼与地方订聘用法不同；不写死为“大聘”或“小聘”。
 * 5. 万圣夜=10月31日Halloween；本文件万圣节=11月1日All Saints' Day。
 * 6. 小年有地区差异；当前腊月廿三规则宜标作“小年（北方）”。
 * 7. “无”是未列事项的占位语；“诸事不宜”“馀事勿取”是限制性总括语。
 *
 * 接入：由Page.explain按词条查询；来源注释不会进入界面。
 * 例如 YI_JI.get("解除")；变体查询可先经YI_JI_ALIASES取规范键。
 * map不含“暂无释义”占位文字；未知键由调用方决定回退文案。
 */
public final class AlmanacNotes {
    private AlmanacNotes() {
    }

    public static final Map<String, String> YI_JI;
    static {
        LinkedHashMap<String, String> m = new LinkedHashMap<String, String>();

        // 上梁
        // 来源：教育部《重编国语辞典修订本》“上梁”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=131992
        m.put("上梁", "架设房屋的正梁，是传统建房的重要工序。");

        // 乘船
        // 来源：《钦定协纪辨方书》卷十一“用事”
        // https://zh.wikisource.org/wiki/欽定協紀辨方書_(四庫全書本)/卷11
        // 核对：古籍有“乘船渡水”用事；按字面作白话释义。
        m.put("乘船", "乘坐船只出行或渡水。");

        // 习艺
        // 来源：镇辕境顶土地公庙《择日术语》；页面自注“网络收集”，仅作交叉核对
        // https://www.foud.com.tw/modules/tadnews/index.php?nsn=541
        m.put("习艺", "学习手艺，或举行拜师礼。");

        // 交易
        // 来源：教育部《重编国语辞典修订本》“交易”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=91102
        m.put("交易", "买卖货物、财产等。");

        // 伐木
        // 来源：《钦定协纪辨方书》卷十一“用事”
        // https://zh.wikisource.org/wiki/欽定協紀辨方書_(四庫全書本)/卷11
        m.put("伐木", "砍伐树木、采备木材。");

        // 会亲友
        // 来源：灵昭道苑《择日学》之择日术语；传统实践口径
        // https://www.356.com.tw/teaching/?parent_id=1293
        m.put("会亲友", "探访、会见或宴请亲戚朋友。");

        // 作梁
        // 来源：镇辕境顶土地公庙《择日术语》；页面自注“网络收集”，仅作交叉核对
        // https://www.foud.com.tw/modules/tadnews/index.php?nsn=541
        // 来源：NCC-908 使用手册，PDF 第38页，建筑篇
        // https://www.ncc.com.tw/soft/download/900/manual/Book908.pdf#page=38
        // 核对：与“上梁”分开；寺庙术语表明确区分制作和安装，NCC“做梁”口径较宽。
        m.put("作梁", "加工木料，制作房屋所用的梁木。");

        // 作灶
        // 来源：灵昭道苑《择日学》之择日术语；传统实践口径
        // https://www.356.com.tw/teaching/?parent_id=1293
        m.put("作灶", "砌造、安设或修整炉灶。");

        // 修坟
        // 来源：桃园市大园区殡葬服务网《择日用事术语注解》；检索可见，直连超时
        // https://cemetery.dayuan.tycg.gov.tw/09/P09S01-07.html
        m.put("修坟", "修整已有坟墓，添土或修补墓体。");

        // 修造
        // 来源：教育部《重编国语辞典修订本》“修造”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=107450
        // 来源：NCC-908 使用手册，PDF 第37页，生活、婚姻、建筑篇
        // https://www.ncc.com.tw/soft/download/900/manual/Book908.pdf#page=37
        // 来源：灵昭道苑《择日学》之择日术语；传统实践口径
        // https://www.356.com.tw/teaching/?parent_id=1293
        // 核对：部分通书狭义指改建修缮；此处保留通行的较宽口径。
        m.put("修造", "修建、改建或修缮房屋等建筑。");

        // 修门
        // 来源：NCC-908 使用手册，PDF 第38页，建筑篇
        // https://www.ncc.com.tw/soft/download/900/manual/Book908.pdf#page=38
        // 核对：人工按“修”与建筑篇“安门”的对象作白话解释；手册未单列“修门”。
        m.put("修门", "修理房屋的门。");

        // 修饰垣墙
        // 来源：镇辕境顶土地公庙《择日术语》；页面自注“网络收集”，仅作交叉核对
        // https://www.foud.com.tw/modules/tadnews/index.php?nsn=541
        // 核对：“垣”即墙；不把整项解释成盖屋。
        m.put("修饰垣墙", "修整、粉刷或装饰围墙、墙面。");

        // 入学
        // 来源：教育部《重编国语辞典修订本》“入学”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=136642
        // 来源：灵昭道苑《择日学》之择日术语；传统实践口径
        // https://www.356.com.tw/teaching/?parent_id=1293
        m.put("入学", "开始上学读书，或举行拜师入学的仪式。");

        // 入宅
        // 来源：教育部《重编国语辞典修订本》“入宅”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=136644
        m.put("入宅", "迁入新居，并举行相关仪式。");

        // 入殓
        // 来源：桃园市大园区殡葬服务网《择日用事术语注解》；检索可见，直连超时
        // https://cemetery.dayuan.tycg.gov.tw/09/P09S01-07.html
        m.put("入殓", "将逝者遗体安放入棺。");

        // 冠笄
        // 来源：教育部《重编国语辞典修订本》“笄冠”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=87374
        // 核对：辞典对应“笄冠”；男女加冠、加笄的成年礼，不固定为一个现代年龄。
        m.put("冠笄", "传统成年礼：男子戴冠，女子插笄（发簪）。");

        // 出火
        // 来源：灵昭道苑《择日学》之择日术语；传统实践口径
        // https://www.356.com.tw/teaching/?parent_id=1293
        // 核对：“火”指香火；不是生火或消防事项。
        m.put("出火", "迁移神位、祖先牌位或供奉的香火。");

        // 出行
        // 来源：教育部《重编国语辞典修订本》“出行”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=124927
        m.put("出行", "离家远行或外出办事。");

        // 出货财
        // 来源：NCC-908 使用手册，PDF 第39页，工商、农牧篇
        // https://www.ncc.com.tw/soft/download/900/manual/Book908.pdf#page=39
        // 核对：手册亦列放债；界面用通俗概括，不延伸为投资建议。
        m.put("出货财", "发出货物、支出钱财，多指出货、销货。");

        // 分居
        // 来源：灵昭道苑《择日学》之择日术语；传统实践口径
        // https://www.356.com.tw/teaching/?parent_id=1293
        // 核对：采用黄历的分家义，不作夫妻分开居住解释。
        m.put("分居", "家族分家，另立门户。");

        // 割蜜
        // 来源：镇辕境顶土地公庙《择日术语》；页面自注“网络收集”，仅作交叉核对
        // https://www.foud.com.tw/modules/tadnews/index.php?nsn=541
        m.put("割蜜", "从蜂巢采收蜂蜜。");

        // 动土
        // 来源：灵昭道苑《择日学》之择日术语；传统实践口径
        // https://www.356.com.tw/teaching/?parent_id=1293
        // 核对：营建用事，与墓葬的“破土”区分。
        m.put("动土", "房屋或工程开始挖土、施工。");

        // 取渔
        // 来源：镇辕境顶土地公庙《择日术语》；页面自注“网络收集”，仅作交叉核对
        // https://www.foud.com.tw/modules/tadnews/index.php?nsn=541
        // 核对：原始键“取渔”；参考资料多写“取鱼”。
        m.put("取渔", "捕鱼。");

        // 合寿木
        // 来源：桃园市大园区殡葬服务网《择日用事术语注解》；检索可见，直连超时
        // https://cemetery.dayuan.tycg.gov.tw/09/P09S01-07.html
        // 核对：“寿木”是棺木，不作种树解释。
        m.put("合寿木", "预先制作或备置棺木。");

        // 合帐
        // 来源：灵昭道苑《择日学》之择日术语；传统实践口径
        // https://www.356.com.tw/teaching/?parent_id=1293
        // 核对：旧义为新房蚊帐；不采用商业“合账”义。
        m.put("合帐", "制作或安设新婚用的帐幔。");

        // 合脊
        // 来源：金门县政府，沙美街区修复“收规合脊”现场报道
        // https://www.kinmen.gov.tw/News_Content2.aspx?n=98E3CA7358C89100&s=72D09BC2B1A1CD4A&sms=BF7D6D478B935644
        // 核对：资料常以“盖屋合脊”合列，本稿拆分解释两项。
        m.put("合脊", "合拢屋顶正脊，完成屋面工程。");

        // 启钻
        // 来源：桃园市大园区殡葬服务网《择日用事术语注解》；检索可见，直连超时
        // https://cemetery.dayuan.tycg.gov.tw/09/P09S01-07.html
        // 核对：6tail原始键作“启钻”；资料多作“启攒”，包括拾骨、洗骨等礼俗。
        m.put("启钻", "为迁葬开启旧墓，捡拾遗骨。");

        // 坏垣
        // 来源：教育部《重编国语辞典修订本》“破屋坏垣”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=22759
        // 核对：与“破屋”对应的墙垣拆除用事。
        m.put("坏垣", "拆除墙垣。");

        // 塑绘
        // 来源：桃园市大园区殡葬服务网《择日用事术语注解》；检索可见，直连超时
        // https://cemetery.dayuan.tycg.gov.tw/09/P09S01-07.html
        m.put("塑绘", "塑造、绘制神像、佛像。");

        // 塞穴
        // 来源：教育部《重编国语辞典修订本》“补垣塞穴”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=20085
        m.put("塞穴", "堵塞洞穴、蚁穴等孔洞。");

        // 嫁娶
        // 来源：教育部《重编国语辞典修订本》“嫁娶”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=89851
        m.put("嫁娶", "举行迎亲、结婚等婚礼仪式。");

        // 安床
        // 来源：教育部《重编国语辞典修订本》“安床”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=147894
        m.put("安床", "安放新床，或重新摆放旧床。");

        // 安机械
        // 来源：灵昭道苑《择日学》之择日术语；传统实践口径
        // https://www.356.com.tw/teaching/?parent_id=1293
        m.put("安机械", "安装机器设备。");

        // 安碓磑
        // 来源：教育部《重编国语辞典修订本》“安碓磑”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=147755
        // 核对：碓duì、磑wèi；采用辞典专条校正网络表中的泛化释义。
        m.put("安碓磑", "安装舂米、磨粉所用的石臼、石磨等器具。");

        // 安葬
        // 来源：教育部《重编国语辞典修订本》“安葬”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=147925
        m.put("安葬", "将棺木、遗骨等安置入墓。");

        // 安门
        // 来源：教育部《重编国语辞典修订本》“安门”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=147712
        m.put("安门", "安装房屋的门扇或大门。");

        // 安香
        // 来源：教育部《重编国语辞典修订本》“安香”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=147873
        // 来源：灵昭道苑《择日学》之择日术语；传统实践口径
        // https://www.356.com.tw/teaching/?parent_id=1293
        m.put("安香", "安奉神位、祖先牌位和香火。");

        // 定磉
        // 来源：灵昭道苑《择日学》之择日术语；传统实践口径
        // https://www.356.com.tw/teaching/?parent_id=1293
        // 核对：“磉”指柱下的石础。
        m.put("定磉", "安放、固定柱子底下的基石。");

        // 平治道涂
        // 来源：《钦定协纪辨方书》卷十一“用事”
        // https://zh.wikisource.org/wiki/欽定協紀辨方書_(四庫全書本)/卷11
        // 核对：“涂”通“途”，此处指道路。
        m.put("平治道涂", "修整、铺平道路。");

        // 开仓
        // 来源：灵昭道苑《择日学》之择日术语；传统实践口径
        // https://www.356.com.tw/teaching/?parent_id=1293
        // 核对：黄历用事；不是金融衍生品“开仓”。
        m.put("开仓", "开启仓库，办理发货、销货等事。");

        // 开光
        // 来源：教育部《重编国语辞典修订本》“开光”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=76672
        // 来源：桃园市大园区殡葬服务网《择日用事术语注解》；检索可见，直连超时
        // https://cemetery.dayuan.tycg.gov.tw/09/P09S01-07.html
        // 来源：NCC-908 使用手册，PDF 第36页《择日用事术语注解》祭祀、生活篇
        // https://www.ncc.com.tw/soft/download/900/manual/Book908.pdf#page=36
        // 核对：各宗教对开光、点眼的仪轨有别，此处作共同概括。
        m.put("开光", "正式供奉神佛像前举行的宗教仪式。");

        // 开厕
        // 来源：灵昭道苑《择日学》之择日术语；传统实践口径
        // https://www.356.com.tw/teaching/?parent_id=1293
        m.put("开厕", "开工建造厕所。");

        // 开市
        // 来源：教育部《重编国语辞典修订本》“开市”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=76801
        m.put("开市", "商店、企业开业，或节后恢复营业、开工。");

        // 开柱眼
        // 来源：镇辕境顶土地公庙《择日术语》；页面自注“网络收集”，仅作交叉核对
        // https://www.foud.com.tw/modules/tadnews/index.php?nsn=541
        m.put("开柱眼", "在建筑木柱上开凿安装构件所需的孔眼。");

        // 开池
        // 来源：灵昭道苑《择日学》之择日术语；传统实践口径
        // https://www.356.com.tw/teaching/?parent_id=1293
        m.put("开池", "开挖水池或池塘。");

        // 开渠
        // 来源：《钦定协纪辨方书》卷十一“用事”
        // https://zh.wikisource.org/wiki/欽定協紀辨方書_(四庫全書本)/卷11
        m.put("开渠", "开挖、修筑沟渠或排水通道。");

        // 开生坟
        // 来源：桃园市大园区殡葬服务网《择日用事术语注解》；检索可见，直连超时
        // https://cemetery.dayuan.tycg.gov.tw/09/P09S01-07.html
        m.put("开生坟", "在生前预先营造墓穴。");

        // 归宁
        // 来源：教育部《重编国语辞典修订本》“归宁”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=73041
        // 核对：按婚俗常用义；一般辞典也有男子归省父母的古义。
        m.put("归宁", "已婚女子回娘家探望父母。");

        // 归岫
        // 来源：灵昭道苑《择日学》之择日术语；传统实践口径
        // https://www.356.com.tw/teaching/?parent_id=1293
        // 来源：NCC-908 使用手册，PDF 第38页，建筑篇
        // https://www.ncc.com.tw/soft/download/900/manual/Book908.pdf#page=38
        // 核对：有口径差异：道苑详释为寄梁后固定梁木；NCC手册宽释为房屋接近完工时的最后工程。采用前者，不作归隐、返乡或安葬解释。
        m.put("归岫", "安放并固定梁木，是传统建房的一道工序。");

        // 成服
        // 来源：教育部《重编国语辞典修订本》“成服”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=124198
        m.put("成服", "依照丧礼习俗，开始穿戴丧服。");

        // 扫舍
        // 来源：桃园市大园区殡葬服务网《择日用事术语注解》；检索可见，直连超时
        // https://cemetery.dayuan.tycg.gov.tw/09/P09S01-07.html
        // 核对：不把通书中某些丧礼附义强加给所有“扫舍”。
        m.put("扫舍", "清扫、整理房屋和庭院。");

        // 拆卸
        // 来源：灵昭道苑《择日学》之择日术语；传统实践口径
        // https://www.356.com.tw/teaching/?parent_id=1293
        m.put("拆卸", "拆除房屋或建筑构件。");

        // 挂匾
        // 来源：灵昭道苑《择日学》之择日术语；传统实践口径
        // https://www.356.com.tw/teaching/?parent_id=1293
        m.put("挂匾", "悬挂招牌或匾额。");

        // 捕捉
        // 来源：教育部《重编国语辞典修订本》“捕捉畋猎”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=19950
        // 核对：沿用农牧择日常见义；与“畋猎”分开。
        m.put("捕捉", "捕捉家中、农田里的害虫和鼠类。");

        // 掘井
        // 来源：《钦定协纪辨方书》卷十一“用事”
        // https://zh.wikisource.org/wiki/欽定協紀辨方書_(四庫全書本)/卷11
        m.put("掘井", "开凿水井。");

        // 探病
        // 来源：教育部《重编国语辞典修订本》“探病”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=51335
        m.put("探病", "探望、慰问生病的人。");

        // 放水
        // 来源：镇辕境顶土地公庙《择日术语》；页面自注“网络收集”，仅作交叉核对
        // https://www.foud.com.tw/modules/tadnews/index.php?nsn=541
        // 核对：采用传统水利用事义，不作现代比赛“放水”义。
        m.put("放水", "向池塘、水田等引水、蓄水。");

        // 教牛马
        // 来源：镇辕境顶土地公庙《择日术语》；页面自注“网络收集”，仅作交叉核对
        // https://www.foud.com.tw/modules/tadnews/index.php?nsn=541
        m.put("教牛马", "训练牛马，使其能够耕作、拉车。");

        // 整手足甲
        // 来源：NCC-908 使用手册，PDF 第37页，生活、婚姻、建筑篇
        // https://www.ncc.com.tw/soft/download/900/manual/Book908.pdf#page=37
        // 来源：《钦定协纪辨方书》卷十一“用事”
        // https://zh.wikisource.org/wiki/欽定協紀辨方書_(四庫全書本)/卷11
        // 核对：有些通书专说婴儿首次剪甲；古籍用事范围较宽，故不写死为首次。
        m.put("整手足甲", "修剪手指甲、脚趾甲。");

        // 斋醮
        // 来源：教育部《重编国语辞典修订本》“斋醮”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=115110
        // 核对：兼顾祈安醮与荐亡斋醮，不只解释为某一种丧事。
        m.put("斋醮", "通过斋戒、设坛等仪式祈福、消灾或超度亡者。");

        // 断蚁
        // 来源：NCC-908 使用手册，PDF 第39页，工商、农牧篇
        // https://www.ncc.com.tw/soft/download/900/manual/Book908.pdf#page=39
        m.put("断蚁", "阻断蚁路、清除蚁患。");

        // 无
        // 来源：6tail/lunar-javascript v1.7.8，日宜忌实现与原始词表
        // https://github.com/6tail/lunar-javascript/blob/v1.7.8/lunar.js
        // 核对：数据占位语；不据此推出“诸事皆宜”或“诸事皆忌”。
        m.put("无", "当日未列出具体事项。");

        // 普渡
        // 来源：教育部《重编国语辞典修订本》“普渡”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=26553
        // 核对：原始键“普渡”；资料也作“普度”。
        m.put("普渡", "通过祭祀、施食等仪式超度亡魂。");

        // 架马
        // 来源：灵昭道苑《择日学》之择日术语；传统实践口径
        // https://www.356.com.tw/teaching/?parent_id=1293
        // 核对：与骑马、上马无关；不同通书亦有板模等延伸。
        m.put("架马", "搭设施工用的脚手架、作业架。");

        // 栽种
        // 来源：教育部《重编国语辞典修订本》“栽种”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=138319
        // 来源：镇辕境顶土地公庙《择日术语》；页面自注“网络收集”，仅作交叉核对
        // https://www.foud.com.tw/modules/tadnews/index.php?nsn=541
        m.put("栽种", "播种、栽植或嫁接植物。");

        // 求医
        // 来源：灵昭道苑《择日学》之择日术语；传统实践口径
        // https://www.356.com.tw/teaching/?parent_id=1293
        // 核对：仅解释用语；词条不影响实际就医安排。
        m.put("求医", "寻求医者诊治。");

        // 求嗣
        // 来源：桃园市大园区殡葬服务网《择日用事术语注解》；检索可见，直连超时
        // https://cemetery.dayuan.tycg.gov.tw/09/P09S01-07.html
        m.put("求嗣", "向神明祈求子女。");

        // 沐浴
        // 来源：教育部《重编国语辞典修订本》“沐浴”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=32947
        // 来源：灵昭道苑《择日学》之择日术语；传统实践口径
        // https://www.356.com.tw/teaching/?parent_id=1293
        m.put("沐浴", "洗浴、洁净身体；旧时也指祭祷前洁身斋戒。");

        // 治病
        // 来源：《钦定协纪辨方书》卷十一“用事”
        // https://zh.wikisource.org/wiki/欽定協紀辨方書_(四庫全書本)/卷11
        // 核对：仅解释用语；不把黄历宜忌作为延误医疗的依据。
        m.put("治病", "诊治疾病。");

        // 牧养
        // 来源：镇辕境顶土地公庙《择日术语》；页面自注“网络收集”，仅作交叉核对
        // https://www.foud.com.tw/modules/tadnews/index.php?nsn=541
        m.put("牧养", "放牧、饲养家畜家禽。");

        // 理发
        // 来源：教育部《重编国语辞典修订本》“理发”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=61955
        // 核对：部分通书“剃头”专说婴儿首次剃发，本键为“理发”，用较宽释义。
        m.put("理发", "修剪、整理头发。");

        // 畋猎
        // 来源：教育部《重编国语辞典修订本》“畋猎”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=53542
        m.put("畋猎", "狩猎，捕取飞禽走兽。");

        // 盖屋
        // 来源：NCC-908 使用手册，PDF 第37页，生活、婚姻、建筑篇
        // https://www.ncc.com.tw/soft/download/900/manual/Book908.pdf#page=37
        // 来源：灵昭道苑《择日学》之择日术语；传统实践口径
        // https://www.356.com.tw/teaching/?parent_id=1293
        // 核对：保留独立词和合列用语的范围差异。
        m.put("盖屋", "兴建房屋；在“盖屋合脊”中也指搭建屋顶。");

        // 破土
        // 来源：教育部《重编国语辞典修订本》“破土”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=22627
        // 核对：黄历特指墓葬用事；与阳宅工程“动土”区分。
        m.put("破土", "为墓葬开挖土地、营造墓穴。");

        // 破屋
        // 来源：教育部《重编国语辞典修订本》“破屋坏垣”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=22759
        m.put("破屋", "拆除房屋。");

        // 祈福
        // 来源：教育部《重编国语辞典修订本》“祈福”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=98408
        m.put("祈福", "向神明祈求福祉、平安。");

        // 祭祀
        // 来源：教育部《重编国语辞典修订本》“祭祀”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=88912
        m.put("祭祀", "祭拜祖先或神明。");

        // 移徙
        // 来源：灵昭道苑《择日学》之择日术语；传统实践口径
        // https://www.356.com.tw/teaching/?parent_id=1293
        m.put("移徙", "迁移住所、搬家。");

        // 移柩
        // 来源：桃园市大园区殡葬服务网《择日用事术语注解》；检索可见，直连超时
        // https://cemetery.dayuan.tycg.gov.tw/09/P09S01-07.html
        m.put("移柩", "在丧葬仪式中移动棺木，常指出殡前移出停灵处。");

        // 立券
        // 来源：教育部《重编国语辞典修订本》“立券交易”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=62366
        m.put("立券", "订立买卖等事项的契约、凭据。");

        // 立碑
        // 来源：桃园市大园区殡葬服务网《择日用事术语注解》；检索可见，直连超时
        // https://cemetery.dayuan.tycg.gov.tw/09/P09S01-07.html
        m.put("立碑", "竖立墓碑或纪念碑。");

        // 竖柱
        // 来源：灵昭道苑《择日学》之择日术语；传统实践口径
        // https://www.356.com.tw/teaching/?parent_id=1293
        m.put("竖柱", "竖立房屋的柱子。");

        // 筑堤
        // 来源：《钦定协纪辨方书》卷十一“用事”
        // https://zh.wikisource.org/wiki/欽定協紀辨方書_(四庫全書本)/卷11
        m.put("筑堤", "修筑、加固堤防。");

        // 纳婿
        // 来源：教育部《重编国语辞典修订本》“纳婿”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=56232
        m.put("纳婿", "男方入赘女家成婚。");

        // 纳畜
        // 来源：教育部《重编国语辞典修订本》“牧养纳畜”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=33114
        // 来源：镇辕境顶土地公庙《择日术语》；页面自注“网络收集”，仅作交叉核对
        // https://www.foud.com.tw/modules/tadnews/index.php?nsn=541
        m.put("纳畜", "买进或接纳家畜、家禽来饲养。");

        // 纳财
        // 来源：教育部《重编国语辞典修订本》“纳财”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=56242
        // 核对：采用历史用事义，不扩写为投资获利预测。
        m.put("纳财", "收租、收账、进货或收取钱粮等财物。");

        // 纳采
        // 来源：教育部《重编国语辞典修订本》“纳采”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=56243
        // 来源：NCC-908 使用手册，PDF 第37页，生活、婚姻、建筑篇
        // https://www.ncc.com.tw/soft/download/900/manual/Book908.pdf#page=37
        // 核对：古六礼的第一礼；地方通书有小聘、大聘等不同口径，故不写死。
        m.put("纳采", "传统婚礼中由媒人送礼、正式提亲的礼节；后来也泛指订婚送礼。");

        // 经络
        // 来源：灵昭道苑《择日学》之择日术语；传统实践口径
        // https://www.356.com.tw/teaching/?parent_id=1293
        // 核对：黄历取纺织义；不是人体经脉。
        m.put("经络", "整理丝麻、织造布料，或安设纺织机具。");

        // 结网
        // 来源：镇辕境顶土地公庙《择日术语》；页面自注“网络收集”，仅作交叉核对
        // https://www.foud.com.tw/modules/tadnews/index.php?nsn=541
        m.put("结网", "编结渔网等捕捞用的网具。");

        // 置产
        // 来源：教育部《重编国语辞典修订本》“置产”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=114528
        m.put("置产", "购置房屋、土地等产业。");

        // 行丧
        // 来源：《吕氏春秋·节丧》原文“世俗之行丧”及相关葬仪语境
        // https://ctext.org/lv-shi-chun-qiu/jie-sang/zh
        // 来源：科技紫微网《宜忌解说》丧葬类；另一种现代通书口径
        // https://ecal.click108.com.tw/nmlSy.php?type=6
        // 核对：存在实质性口径差异：古籍有举行丧事之义，部分现代黄历释作到丧家慰问。此处并列说明；不能宣称已确认6tail内部采用哪一义。
        m.put("行丧", "操办丧事、举行丧葬仪式，也可指到丧家吊唁。");

        // 补垣
        // 来源：教育部《重编国语辞典修订本》“补垣塞穴”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=20085
        m.put("补垣", "修补破损的墙垣。");

        // 裁衣
        // 来源：教育部《重编国语辞典修订本》“裁衣”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=141187
        // 核对：特定婚丧场景会涉及婚服、寿衣；不把范围限于两者。
        m.put("裁衣", "裁剪、缝制衣服。");

        // 解除
        // 来源：教育部《重编国语辞典修订本》“解除”第2义
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=90669&la=0&powerMode=0
        // 来源：桃园市大园区殡葬服务网《择日用事术语注解》；检索可见，直连超时
        // https://cemetery.dayuan.tycg.gov.tw/09/P09S01-07.html
        // 来源：NCC-908 使用手册，PDF 第36页《择日用事术语注解》祭祀、生活篇
        // https://www.ncc.com.tw/soft/download/900/manual/Book908.pdf#page=36
        // 核对：兼顾辞典古义与通书扩展义；不简单等同于打扫卫生，也不作解除合同解释。
        m.put("解除", "通过祭祷祈求消灾除秽，也包括清洗宅舍等仪式。");

        // 订盟
        // 来源：灵昭道苑《择日学》之择日术语；传统实践口径
        // https://www.356.com.tw/teaching/?parent_id=1293
        // 核对：黄历常用婚姻义；不按现代政治结盟解释。
        m.put("订盟", "订立婚约，举行订婚礼。");

        // 词讼
        // 来源：教育部《重编国语辞典修订本》“词讼”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=140521
        m.put("词讼", "提起诉讼或处理官司。");

        // 诸事不宜
        // 来源：《钦定协纪辨方书》卷十“宜忌”
        // https://zh.wikisource.org/wiki/欽定協紀辨方書_(四庫全書本)/卷10
        // 来源：6tail/lunar-javascript v1.7.8，日宜忌实现与原始词表
        // https://github.com/6tail/lunar-javascript/blob/v1.7.8/lunar.js
        // 核对：这是编辑性的白话概括，不解释成日常吃饭、睡觉也不能做。
        m.put("诸事不宜", "这一天不宜操办重要事项。");

        // 谢土
        // 来源：桃园市大园区殡葬服务网《择日用事术语注解》；检索可见，直连超时
        // https://cemetery.dayuan.tycg.gov.tw/09/P09S01-07.html
        m.put("谢土", "建造、修缮房屋或营造墓葬等工程完成后，祭谢土地神。");

        // 赴任
        // 来源：教育部《重编国语辞典修订本》“赴任”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=38797
        m.put("赴任", "前往任职的地方就职。");

        // 起基
        // 来源：灵昭道苑《择日学》之择日术语；传统实践口径
        // https://www.356.com.tw/teaching/?parent_id=1293
        m.put("起基", "开始开挖、砌筑房屋地基。");

        // 进人口
        // 来源：灵昭道苑《择日学》之择日术语；传统实践口径
        // https://www.356.com.tw/teaching/?parent_id=1293
        // 核对：各通书范围不一；不直接等同分娩或现代人口统计。
        m.put("进人口", "家中增添新成员，旧时多指收养子女等。");

        // 造仓
        // 来源：镇辕境顶土地公庙《择日术语》；页面自注“网络收集”，仅作交叉核对
        // https://www.foud.com.tw/modules/tadnews/index.php?nsn=541
        m.put("造仓", "建造储存粮食、货物的仓库。");

        // 造庙
        // 来源：灵昭道苑《择日学》之择日术语；传统实践口径
        // https://www.356.com.tw/teaching/?parent_id=1293
        m.put("造庙", "建造寺庙、宫观等宗教场所。");

        // 造桥
        // 来源：镇辕境顶土地公庙《择日术语》；页面自注“网络收集”，仅作交叉核对
        // https://www.foud.com.tw/modules/tadnews/index.php?nsn=541
        m.put("造桥", "建造桥梁。");

        // 造畜稠
        // 来源：教育部《重编国语辞典修订本》“造畜稠栈”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=138708
        // 核对：保留6tail原始键；对照“造畜稠栈”“造畜稠栖栈”等完整用语，不擅改资产中的字。
        m.put("造畜稠", "修建供家畜家禽栖息的圈舍、栏棚。");

        // 造船
        // 来源：镇辕境顶土地公庙《择日术语》；页面自注“网络收集”，仅作交叉核对
        // https://www.foud.com.tw/modules/tadnews/index.php?nsn=541
        m.put("造船", "制造船只。");

        // 造车器
        // 来源：灵昭道苑《择日学》之择日术语；传统实践口径
        // https://www.356.com.tw/teaching/?parent_id=1293
        // 核对：原义为制造；不把所有购车、提车自动算入。
        m.put("造车器", "制造车辆等器具。");

        // 酬神
        // 来源：教育部《重编国语辞典修订本》“酬神”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=122627
        m.put("酬神", "还愿、祭谢神明。");

        // 针灸
        // 来源：NCC-908 使用手册，PDF 第37页，生活、婚姻、建筑篇
        // https://www.ncc.com.tw/soft/download/900/manual/Book908.pdf#page=37
        // 核对：用语释义，不含疗效或择日就医建议。
        m.put("针灸", "使用针刺、艾灸等传统疗法治病。");

        // 问名
        // 来源：教育部《重编国语辞典修订本》“问名”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=162432
        // 核对：对应古代六礼的问名礼；辞典专条核实姓名、生年月日的议婚用途。
        m.put("问名", "传统婚礼中询问女方姓名、出生年月等，以便议婚。");

        // 除服
        // 来源：教育部《重编国语辞典修订本》“除服”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=125184
        m.put("除服", "服丧期满，脱去丧服。");

        // 雇佣
        // 来源：教育部《重编国语辞典修订本》“雇佣”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=71581
        m.put("雇佣", "付给报酬，请人做事。");

        // 雕刻
        // 来源：教育部《重编国语辞典修订本》“雕刻”
        // https://dict.revised.moe.edu.tw/dictView.jsp?ID=45784
        m.put("雕刻", "雕刻造像，多指神像、佛像。");

        // 馀事勿取
        // 来源：岁时黄历作者自编《宜忌用语词典》特殊条目；仅此条作现代用法参考
        // https://yihuangli.com/baike/yiji
        // 来源：《钦定协纪辨方书》卷十“宜忌”
        // https://zh.wikisource.org/wiki/欽定協紀辨方書_(四庫全書本)/卷10
        // 核对：馀同余；现代词典交叉参考。古籍链接提供“馀事皆忌”等语境，不宣称是该四字的最早出处；不写“危险程度仅次于诸事不宜”等无可靠依据的排序。
        m.put("馀事勿取", "除当日已列明可做的事外，其余事情都不宜操办。");
        YI_JI = Collections.unmodifiableMap(m);
    }

    public static final Map<String, String> JIAN_CHU;
    static {
        LinkedHashMap<String, String> m = new LinkedHashMap<String, String>();

        // 建
        // 来源：《钦定协纪辨方书》卷四“建除十二神”
        // https://zh.wikisource.org/wiki/欽定協紀辨方書_(四庫全書本)/卷04
        m.put("建", "有建立、起始之意。");

        // 除
        // 来源：《钦定协纪辨方书》卷四“建除十二神”
        // https://zh.wikisource.org/wiki/欽定協紀辨方書_(四庫全書本)/卷04
        m.put("除", "有除旧布新之意。");

        // 满
        // 来源：《钦定协纪辨方书》卷四“建除十二神”
        // https://zh.wikisource.org/wiki/欽定協紀辨方書_(四庫全書本)/卷04
        m.put("满", "有充盈、丰足之意。");

        // 平
        // 来源：《钦定协纪辨方书》卷四“建除十二神”
        // https://zh.wikisource.org/wiki/欽定協紀辨方書_(四庫全書本)/卷04
        m.put("平", "有平整、均衡之意。");

        // 定
        // 来源：《钦定协纪辨方书》卷四“建除十二神”
        // https://zh.wikisource.org/wiki/欽定協紀辨方書_(四庫全書本)/卷04
        m.put("定", "有安定、确定之意。");

        // 执
        // 来源：《钦定协纪辨方书》卷四“建除十二神”
        // https://zh.wikisource.org/wiki/欽定協紀辨方書_(四庫全書本)/卷04
        m.put("执", "有执持、坚守之意。");

        // 破
        // 来源：《钦定协纪辨方书》卷四“建除十二神”
        // https://zh.wikisource.org/wiki/欽定協紀辨方書_(四庫全書本)/卷04
        m.put("破", "有冲破、破除之意。");

        // 危
        // 来源：《钦定协纪辨方书》卷四“建除十二神”
        // https://zh.wikisource.org/wiki/欽定協紀辨方書_(四庫全書本)/卷04
        // 核对：按古籍“既破而心知危”释名；不按字面判定所有事情危险。
        m.put("危", "有警惕危险、谨慎行事之意。");

        // 成
        // 来源：《钦定协纪辨方书》卷四“建除十二神”
        // https://zh.wikisource.org/wiki/欽定協紀辨方書_(四庫全書本)/卷04
        m.put("成", "有成就、完成之意。");

        // 收
        // 来源：《钦定协纪辨方书》卷四“建除十二神”
        // https://zh.wikisource.org/wiki/欽定協紀辨方書_(四庫全書本)/卷04
        m.put("收", "有收敛、收纳之意。");

        // 开
        // 来源：《钦定协纪辨方书》卷四“建除十二神”
        // https://zh.wikisource.org/wiki/欽定協紀辨方書_(四庫全書本)/卷04
        m.put("开", "有开启、通达之意。");

        // 闭
        // 来源：《钦定协纪辨方书》卷四“建除十二神”
        // https://zh.wikisource.org/wiki/欽定協紀辨方書_(四庫全書本)/卷04
        m.put("闭", "有封闭、收藏之意。");
        JIAN_CHU = Collections.unmodifiableMap(m);
    }

    public static final Map<String, String> SOLAR_TERMS;
    static {
        LinkedHashMap<String, String> m = new LinkedHashMap<String, String>();

        // 立春
        // 来源：香港天文台《二十四节气》天文定义及黄经表
        // https://www.hko.gov.hk/sc/gts/time/24solarterms.htm
        // 来源：中国非物质文化遗产网《二十四节气之立春》
        // https://www.ihchina.cn/Article/Index/detail?id=9706
        // 核对：节气四立不是各地气象入季日。
        m.put("立春", "春季的第一个节气，民间有迎春、咬春等习俗。");

        // 雨水
        // 来源：香港天文台《二十四节气》天文定义及黄经表
        // https://www.hko.gov.hk/sc/gts/time/24solarterms.htm
        // 来源：吴澄《月令七十二候集解》，节气名称与传统物候
        // https://zh.wikisource.org/wiki/月令七十二候集解
        // 核对：描述传统物候，不保证所在地区当日降雨。
        m.put("雨水", "冰雪渐融、降水渐多的时节。");

        // 惊蛰
        // 来源：香港天文台《二十四节气》天文定义及黄经表
        // https://www.hko.gov.hk/sc/gts/time/24solarterms.htm
        // 来源：吴澄《月令七十二候集解》，节气名称与传统物候
        // https://zh.wikisource.org/wiki/月令七十二候集解
        // 核对：“雷惊虫醒”是传统物候表达，不作昆虫苏醒机制解释。
        m.put("惊蛰", "春雷始动，蛰虫苏醒，正是仲春的景象。");

        // 春分
        // 来源：香港天文台《二十四节气》天文定义及黄经表
        // https://www.hko.gov.hk/sc/gts/time/24solarterms.htm
        // 核对：用“接近”，不宣称所有地点昼夜严格相等。
        m.put("春分", "太阳直射赤道，全球大部分地区昼夜长短接近；此后北半球白昼渐长。");

        // 清明
        // 来源：香港天文台《二十四节气》天文定义及黄经表
        // https://www.hko.gov.hk/sc/gts/time/24solarterms.htm
        // 来源：中国非物质文化遗产网《二十四节气专题》
        // https://www.ihchina.cn/solar_terms.html
        // 核对：本键保留节气、节日两种身份。
        m.put("清明", "既是节气，也是传统节日，有扫墓祭祖、踏青等习俗。");

        // 谷雨
        // 来源：香港天文台《二十四节气》天文定义及黄经表
        // https://www.hko.gov.hk/sc/gts/time/24solarterms.htm
        // 来源：吴澄《月令七十二候集解》，节气名称与传统物候
        // https://zh.wikisource.org/wiki/月令七十二候集解
        m.put("谷雨", "取“雨生百谷”之意，正是春季播种、作物生长的时节。");

        // 立夏
        // 来源：香港天文台《二十四节气》天文定义及黄经表
        // https://www.hko.gov.hk/sc/gts/time/24solarterms.htm
        // 来源：吴澄《月令七十二候集解》，节气名称与传统物候
        // https://zh.wikisource.org/wiki/月令七十二候集解
        m.put("立夏", "夏季的第一个节气，草木生长渐盛。");

        // 小满
        // 来源：香港天文台《二十四节气》天文定义及黄经表
        // https://www.hko.gov.hk/sc/gts/time/24solarterms.htm
        // 来源：吴澄《月令七十二候集解》，节气名称与传统物候
        // https://zh.wikisource.org/wiki/月令七十二候集解
        // 核对：后半为农时的通行白话概括；不写成“已经成熟”。
        m.put("小满", "夏熟作物的籽粒逐渐饱满，但尚未成熟。");

        // 芒种
        // 来源：香港天文台《二十四节气》天文定义及黄经表
        // https://www.hko.gov.hk/sc/gts/time/24solarterms.htm
        // 来源：中国非物质文化遗产网《二十四节气之芒种》
        // https://www.ihchina.cn/Article/Index/detail?id=9960
        m.put("芒种", "有芒作物收割、播种的时节，农事繁忙。");

        // 夏至
        // 来源：香港天文台《二十四节气》天文定义及黄经表
        // https://www.hko.gov.hk/sc/gts/time/24solarterms.htm
        // 核对：按北半球口径；不写成“全年最热”。
        m.put("夏至", "太阳直射北回归线，北半球迎来一年中白昼最长的一天。");

        // 小暑
        // 来源：香港天文台《二十四节气》天文定义及黄经表
        // https://www.hko.gov.hk/sc/gts/time/24solarterms.htm
        // 来源：吴澄《月令七十二候集解》，节气名称与传统物候
        // https://zh.wikisource.org/wiki/月令七十二候集解
        m.put("小暑", "天气逐渐炎热。");

        // 大暑
        // 来源：香港天文台《二十四节气》天文定义及黄经表
        // https://www.hko.gov.hk/sc/gts/time/24solarterms.htm
        // 来源：吴澄《月令七十二候集解》，节气名称与传统物候
        // https://zh.wikisource.org/wiki/月令七十二候集解
        // 核对：不把传统时令描述当成各地当年的最高温预报。
        m.put("大暑", "暑热正盛，通常是一年中最炎热的时节。");

        // 立秋
        // 来源：香港天文台《二十四节气》天文定义及黄经表
        // https://www.hko.gov.hk/sc/gts/time/24solarterms.htm
        // 来源：吴澄《月令七十二候集解》，节气名称与传统物候
        // https://zh.wikisource.org/wiki/月令七十二候集解
        // 核对：“暑热尚存”为季节与实况的区分，不保证当地天气。
        m.put("立秋", "秋季的第一个节气，此时暑热往往尚未消退。");

        // 处暑
        // 来源：香港天文台《二十四节气》天文定义及黄经表
        // https://www.hko.gov.hk/sc/gts/time/24solarterms.htm
        // 来源：吴澄《月令七十二候集解》，节气名称与传统物候
        // https://zh.wikisource.org/wiki/月令七十二候集解
        m.put("处暑", "“处”有终止之意，暑气渐退，天气逐渐转凉。");

        // 白露
        // 来源：香港天文台《二十四节气》天文定义及黄经表
        // https://www.hko.gov.hk/sc/gts/time/24solarterms.htm
        // 来源：吴澄《月令七十二候集解》，节气名称与传统物候
        // https://zh.wikisource.org/wiki/月令七十二候集解
        m.put("白露", "天气转凉，草木上凝结露水。");

        // 秋分
        // 来源：香港天文台《二十四节气》天文定义及黄经表
        // https://www.hko.gov.hk/sc/gts/time/24solarterms.htm
        // 核对：同春分，不宣称昼夜严格相等。
        m.put("秋分", "太阳直射赤道，全球大部分地区昼夜长短接近；此后北半球白昼渐短。");

        // 寒露
        // 来源：香港天文台《二十四节气》天文定义及黄经表
        // https://www.hko.gov.hk/sc/gts/time/24solarterms.htm
        // 来源：中国非物质文化遗产网《二十四节气之寒露》
        // https://www.ihchina.cn/Article/Index/detail?id=9809
        // 核对：不是“露水已经全部结霜”。
        m.put("寒露", "露水已带寒意，天气由凉转冷。");

        // 霜降
        // 来源：香港天文台《二十四节气》天文定义及黄经表
        // https://www.hko.gov.hk/sc/gts/time/24solarterms.htm
        // 来源：吴澄《月令七十二候集解》，节气名称与传统物候
        // https://zh.wikisource.org/wiki/月令七十二候集解
        // 核对：名称不表示全国各地当天一定有霜。
        m.put("霜降", "深秋时节，寒意渐浓，开始见霜。");

        // 立冬
        // 来源：香港天文台《二十四节气》天文定义及黄经表
        // https://www.hko.gov.hk/sc/gts/time/24solarterms.htm
        // 来源：吴澄《月令七十二候集解》，节气名称与传统物候
        // https://zh.wikisource.org/wiki/月令七十二候集解
        m.put("立冬", "冬季的第一个节气，万物收敛、闭藏。");

        // 小雪
        // 来源：香港天文台《二十四节气》天文定义及黄经表
        // https://www.hko.gov.hk/sc/gts/time/24solarterms.htm
        // 来源：吴澄《月令七十二候集解》，节气名称与传统物候
        // https://zh.wikisource.org/wiki/月令七十二候集解
        // 核对：与天气预报中的“小雪”等级分属不同概念。
        m.put("小雪", "天气转寒，降雪开始增多。");

        // 大雪
        // 来源：香港天文台《二十四节气》天文定义及黄经表
        // https://www.hko.gov.hk/sc/gts/time/24solarterms.htm
        // 来源：吴澄《月令七十二候集解》，节气名称与传统物候
        // https://zh.wikisource.org/wiki/月令七十二候集解
        // 核对：与天气预报中的“大雪”等级分属不同概念，不保证当天有雪。
        m.put("大雪", "天气更加寒冷，降雪也渐多。");

        // 冬至
        // 来源：香港天文台《二十四节气》天文定义及黄经表
        // https://www.hko.gov.hk/sc/gts/time/24solarterms.htm
        // 来源：中国非物质文化遗产网《二十四节气之冬至》
        // https://www.ihchina.cn/Article/Index/detail?id=9743
        // 核对：按北半球口径；不写成“全年最冷”。
        m.put("冬至", "太阳直射南回归线，北半球迎来一年中白昼最短的一天；民间有贺冬等习俗。");

        // 小寒
        // 来源：香港天文台《二十四节气》天文定义及黄经表
        // https://www.hko.gov.hk/sc/gts/time/24solarterms.htm
        // 来源：吴澄《月令七十二候集解》，节气名称与传统物候
        // https://zh.wikisource.org/wiki/月令七十二候集解
        // 核对：节气年度顺序以立春为首；不对小寒、大寒实测温度强行排序。
        m.put("小寒", "二十四节气中的倒数第二个，正值隆冬，天气寒冷。");

        // 大寒
        // 来源：香港天文台《二十四节气》天文定义及黄经表
        // https://www.hko.gov.hk/sc/gts/time/24solarterms.htm
        // 来源：吴澄《月令七十二候集解》，节气名称与传统物候
        // https://zh.wikisource.org/wiki/月令七十二候集解
        // 核对：不宣称每年、各地一定比小寒更冷。
        m.put("大寒", "二十四节气中的最后一个，正值隆冬，天气严寒。");
        SOLAR_TERMS = Collections.unmodifiableMap(m);
    }

    public static final Map<String, String> FESTIVALS;
    static {
        LinkedHashMap<String, String> m = new LinkedHashMap<String, String>();

        // 元旦
        // 来源：国务院2024年修订《全国年节及纪念日放假办法》；此处仅核日期
        // https://app.www.gov.cn/govdata/gov/202411/12/521605/article.html
        // 核对：现代公历口径。
        m.put("元旦", "公历一月一日，新一年的第一天。");

        // 情人节
        // 来源：美国国会图书馆 Today in History — February 14
        // https://www.loc.gov/item/today-in-history/february-14/
        // 核对：不把某个瓦伦丁传说写成已证实的单一起源。
        m.put("情人节", "公历二月十四日，人们以鲜花、贺卡等表达爱意的节日。");

        // 妇女节
        // 来源：联合国“International Women’s Day”
        // https://www.un.org/observances/womens-day
        // 来源：国务院2024年修订《全国年节及纪念日放假办法》；此处仅核日期
        // https://app.www.gov.cn/govdata/gov/202411/12/521605/article.html
        m.put("妇女节", "公历三月八日，庆祝妇女成就、倡导性别平等的国际节日。");

        // 劳动节
        // 来源：国务院2024年修订《全国年节及纪念日放假办法》；此处仅核日期
        // https://app.www.gov.cn/govdata/gov/202411/12/521605/article.html
        // 核对：采用中国大陆的五一日期口径；美国Labor Day日期不同。
        m.put("劳动节", "公历五月一日，国际劳动节，向劳动者致敬。");

        // 青年节
        // 来源：国务院2024年修订《全国年节及纪念日放假办法》；此处仅核日期
        // https://app.www.gov.cn/govdata/gov/202411/12/521605/article.html
        // 核对：采用中国大陆口径；不混用联合国国际青年日。
        m.put("青年节", "公历五月四日，中国青年纪念五四运动的节日。");

        // 儿童节
        // 来源：国务院2024年修订《全国年节及纪念日放假办法》；此处仅核日期
        // https://app.www.gov.cn/govdata/gov/202411/12/521605/article.html
        // 核对：采用中国大陆六一儿童节口径；各国儿童节日期有别。
        m.put("儿童节", "公历六月一日，国际儿童节，倡导关爱儿童。");

        // 建党节
        // 来源：共产党员网《党史百问》：七月一日为党的诞生纪念日
        // https://www.12371.cn/2022/03/16/ARTI1647435369838227.shtml
        // 核对：七一为纪念日；不写成一大于1921年7月1日开幕。
        m.put("建党节", "公历七月一日，中国共产党的诞生纪念日。");

        // 建军节
        // 来源：国防部《“八一”建军节的确立》
        // https://www.mod.gov.cn/gfbw/gfjy_index/js_214151/4916330.html
        // 来源：国务院2024年修订《全国年节及纪念日放假办法》；此处仅核日期
        // https://app.www.gov.cn/govdata/gov/202411/12/521605/article.html
        m.put("建军节", "公历八月一日，中国人民解放军建军纪念日，源于一九二七年南昌起义。");

        // 教师节
        // 来源：教育部《中华人民共和国教师法》第六条
        // https://www.moe.gov.cn/jyb_sjzl/sjzl_zcfg/zcfg_jyfl/tnull_1314.html
        // 核对：采用中国大陆教师节口径。
        m.put("教师节", "公历九月十日，倡导尊师重教、向教师表达敬意的节日。");

        // 国庆节
        // 来源：中央纪委国家监委网站《中华人民共和国大事记》1949年条
        // https://www.ccdi.gov.cn/yaowen/201909/t20190927_201391.html
        // 来源：国务院2024年修订《全国年节及纪念日放假办法》；此处仅核日期
        // https://app.www.gov.cn/govdata/gov/202411/12/521605/article.html
        m.put("国庆节", "公历十月一日，中华人民共和国成立纪念日。");

        // 万圣夜
        // 来源：美国国会图书馆 Today in History — October 31
        // https://www.loc.gov/item/today-in-history/october-31/
        // 核对：中文也常把Halloween称为“万圣节”；保持与11月1日All Saints' Day的区别。
        m.put("万圣夜", "公历十月三十一日，万圣节前夜（Halloween），人们常化装、点南瓜灯、讨糖。");

        // 万圣节
        // 来源：英国圣公会 Common Worship 教会历
        // https://www.churchofengland.org/prayer-and-worship/worship-texts-and-resources/common-worship/churchs-year/calendar
        // 核对：本键严格对应现有11月1日规则。若规则层把“万圣节”改用于10月31日，必须同时调整此释义。
        m.put("万圣节", "公历十一月一日，即诸圣节（All Saints' Day），纪念全体圣徒的节日。");

        // 平安夜
        // 来源：英国圣公会 Calendar：12月24日 Christmas Eve、25日 Christmas Day
        // https://www.churchofengland.org/liturgy/common-worship/calendar-and-date-easter-and-other-variable-dates
        // 核对：采用公历12月25日圣诞节的教会传统。
        m.put("平安夜", "公历十二月二十四日晚，即圣诞节前夜。");

        // 圣诞节
        // 来源：英国圣公会 Calendar：12月24日 Christmas Eve、25日 Christmas Day
        // https://www.churchofengland.org/liturgy/common-worship/calendar-and-date-easter-and-other-variable-dates
        // 核对：不同教会历制存在日期差异；本应用采用12月25日规则。
        m.put("圣诞节", "公历十二月二十五日，纪念耶稣降生的节日；人们也常团聚、互赠礼物。");

        // 春节
        // 来源：中国非物质文化遗产网，国家级非遗项目“春节”
        // https://www.ihchina.cn/ccr_detail/14904/
        // 核对：春节民俗持续时间长于正月初一；本条说明日历日期，不等于完整假期。
        m.put("春节", "农历正月初一，传统新年的开始，有拜年、团聚等习俗。");

        // 元宵
        // 来源：中国非物质文化遗产网，国家级非遗项目“元宵节”
        // https://www.ihchina.cn/project_details/15069
        m.put("元宵", "农历正月十五，又称上元节、灯节，有赏灯、猜灯谜、吃元宵或汤圆等习俗。");

        // 龙抬头
        // 来源：中国非物质文化遗产网《二月二 龙抬头》
        // https://www.ihchina.cn/project_details/10632/
        // 核对：民俗解释；不当作真实龙或天气因果。
        m.put("龙抬头", "农历二月初二，民间祈求风调雨顺，有些地方还有理发的习俗。");

        // 端午
        // 来源：中国非物质文化遗产网，国家级非遗项目“端午节”
        // https://www.ihchina.cn/project_details/14911.html
        // 核对：不把“专为纪念屈原而起源”写成唯一确定结论。
        m.put("端午", "农历五月初五，有吃粽子、赛龙舟、挂艾草等习俗，各地纪念的人物有所不同。");

        // 七夕
        // 来源：中国非物质文化遗产网，国家级非遗项目“七夕节”
        // https://www.ihchina.cn/project_details/14926/
        // 核对：传说与历史事实分开表述。
        m.put("七夕", "农历七月初七，又称乞巧节，与牛郎织女的传说和乞巧习俗相关。");

        // 中元
        // 来源：中国非物质文化遗产网《中元节的由来和习俗》
        // https://www.ihchina.cn/project_details/10219.html
        // 核对：规则可仍用七月十五；文案说明地区差异，不冒称全国只有一个日期。
        m.put("中元", "通常在农历七月十五，有祭祖、普渡等民俗；部分地区在七月十四过节。");

        // 中秋
        // 来源：中国非物质文化遗产网，国家级非遗项目“中秋节”
        // https://www.ihchina.cn/art/detail/id/14931.html
        // 核对：不写成“月亮必定全年最大最圆”；月相与近地点不是一回事。
        m.put("中秋", "农历八月十五，有赏月、吃月饼、亲友团聚等习俗。");

        // 重阳
        // 来源：中国非物质文化遗产网，国家级非遗项目“重阳节”
        // https://www.ihchina.cn/project_details/14939/
        m.put("重阳", "农历九月初九，有登高、赏菊、佩茱萸等习俗，也是敬老的节日。");

        // 腊八
        // 来源：中国非物质文化遗产网《腊八：年味渐浓，事事“粥”全》
        // https://www.ihchina.cn/news_1_details/26400.html
        m.put("腊八", "农历十二月初八，有喝腊八粥、祭祀等习俗；佛教也以这天为释迦牟尼成道日。");

        // 小年
        // 来源：中国非物质文化遗产网《小年至 年味浓》
        // https://www.ihchina.cn/news_1_details/24544.html
        // 核对：现有规则为腊月廿三；建议日历标“小年（北方）”，不能用同一天涵盖所有地区。
        m.put("小年", "春节前祭灶、扫尘、备办年货的节日，北方多在腊月廿三，南方多在廿四。");

        // 除夕
        // 来源：中央纪委网站《欢欢喜喜过春节·年历》“除夕”
        // https://m.ccdi.gov.cn/content/8b/a7/1662.html
        // 来源：中国非物质文化遗产网，国家级非遗项目“春节”
        // https://www.ihchina.cn/ccr_detail/14904/
        // 核对：可能是腊月廿九或三十；继续使用“次日为正月初一”的规则。
        m.put("除夕", "农历一年最后一天的夜晚，有吃年夜饭、守岁等习俗。");

        // 感恩节
        // 来源：美国国家档案馆 Congress Establishes Thanksgiving
        // https://www.archives.gov/legislative/features/thanksgiving
        // 核对：本应用采用美国规则；不泛化为所有国家的感恩节。
        m.put("感恩节", "公历十一月第四个星期四，美国的节日，人们常与家人团聚，共进节日晚餐。");

        // 母亲节
        // 来源：美国众议院《美国法典》4 USC 6：母亲节、父亲节日期
        // https://uscode.house.gov/us/usc/t4/s6/
        // 核对：核对依据为美国日期规定；其他国家、地区日期可能不同。
        m.put("母亲节", "公历五月第二个星期日，向母亲表达感谢的节日。");

        // 父亲节
        // 来源：美国众议院《美国法典》4 USC 6：母亲节、父亲节日期
        // https://uscode.house.gov/us/usc/t4/s6/
        // 核对：核对依据为美国日期规定；其他国家、地区日期可能不同。
        m.put("父亲节", "公历六月第三个星期日，向父亲表达感谢的节日。");
        FESTIVALS = Collections.unmodifiableMap(m);
    }

    public static final Map<String, String> CONCEPTS;
    static {
        LinkedHashMap<String, String> m = new LinkedHashMap<String, String>();

        // 农历
        // 来源：香港天文台《农历历法解说》
        // https://www.weather.gov.hk/sc/education/astronomy-and-time/time-service/00413-the-chinese-agricultural-calendar-explained.html
        // 核对：避免称为纯阴历。
        m.put("农历", "按月相变化安排月份，并通过设置闰月，使月份与季节大致对应。");

        // 闰月
        // 来源：香港天文台《农历历法解说》
        // https://www.weather.gov.hk/sc/education/astronomy-and-time/time-service/00413-the-chinese-agricultural-calendar-explained.html
        // 核对：此处为概念释义，不用简化口诀替代完整置闰算法。
        m.put("闰月", "农历为协调月份与季节而增加的一个月，沿用前一个月的月名并加“闰”字。");

        // 节气
        // 来源：香港天文台《二十四节气》天文定义及黄经表
        // https://www.hko.gov.hk/sc/gts/time/24solarterms.htm
        m.put("节气", "一年中用来标示季节变化的二十四个时点。");

        // 干支
        // 来源：香港天文台《天干和地支》
        // https://www.hko.gov.hk/tc/gts/time/stemsandbranches.htm
        m.put("干支", "十天干与十二地支依次相配，组成六十种组合，循环使用，用来纪年、纪月、纪日等。");

        // 年干支
        // 来源：香港天文台《天干和地支》
        // https://www.hko.gov.hk/tc/gts/time/stemsandbranches.htm
        // 来源：6tail/lunar-javascript v1.7.8，日宜忌实现与原始词表
        // https://github.com/6tail/lunar-javascript/blob/v1.7.8/lunar.js
        // 核对：春节与立春的换年口径可能不同；具体显示跟随既有6tail调用，不在释义中暗改边界。
        m.put("年干支", "用天干、地支表示年份，如甲子年、乙丑年，每六十年循环一次。");

        // 月干支
        // 来源：香港天文台《天干和地支》
        // https://www.hko.gov.hk/tc/gts/time/stemsandbranches.htm
        // 来源：6tail/lunar-javascript v1.7.8，日宜忌实现与原始词表
        // https://github.com/6tail/lunar-javascript/blob/v1.7.8/lunar.js
        // 核对：不同历法字段的月界可能涉及交节；需与构建脚本实际调用一致。
        m.put("月干支", "用天干与地支组合表示月份。");

        // 日干支
        // 来源：香港天文台《天干和地支》
        // https://www.hko.gov.hk/tc/gts/time/stemsandbranches.htm
        // 来源：6tail/lunar-javascript v1.7.8，日宜忌实现与原始词表
        // https://github.com/6tail/lunar-javascript/blob/v1.7.8/lunar.js
        m.put("日干支", "用天干、地支表示日期，每六十天循环一次。");

        // 宜
        // 来源：《钦定协纪辨方书》卷十“宜忌”
        // https://zh.wikisource.org/wiki/欽定協紀辨方書_(四庫全書本)/卷10
        // 来源：6tail/lunar-javascript v1.7.8，日宜忌实现与原始词表
        // https://github.com/6tail/lunar-javascript/blob/v1.7.8/lunar.js
        // 核对：民俗历注含义，不作效果保证。
        m.put("宜", "当日适合办理的事项。");

        // 忌
        // 来源：《钦定协纪辨方书》卷十“宜忌”
        // https://zh.wikisource.org/wiki/欽定協紀辨方書_(四庫全書本)/卷10
        // 来源：6tail/lunar-javascript v1.7.8，日宜忌实现与原始词表
        // https://github.com/6tail/lunar-javascript/blob/v1.7.8/lunar.js
        // 核对：解释传统文字，不作现实医疗、法律等决策指令。
        m.put("忌", "当日不宜办理的事项。");

        // 建除
        // 来源：《钦定协纪辨方书》卷四“建除十二神”
        // https://zh.wikisource.org/wiki/欽定協紀辨方書_(四庫全書本)/卷04
        // 来源：6tail/lunar-javascript v1.7.8，日宜忌实现与原始词表
        // https://github.com/6tail/lunar-javascript/blob/v1.7.8/lunar.js
        // 核对：原典含多家宜忌争论；本文件只释名，不按单一值日重算或覆盖6tail宜忌。
        m.put("建除", "建、除、满、平、定、执、破、危、成、收、开、闭十二种值日名称的统称。");

        // 冲
        // 来源：6tail/lunar-javascript v1.7.8，日宜忌实现与原始词表
        // https://github.com/6tail/lunar-javascript/blob/v1.7.8/lunar.js
        // 来源：灵昭道苑《择日学》之择日术语；传统实践口径
        // https://www.356.com.tw/teaching/?parent_id=1293
        // 核对：与库中日地支、生肖冲的字段对应；不推导个人必有灾祸。
        m.put("冲", "十二地支按相冲关系分为六对，用来表示当天相冲的生肖，如子日冲马。");

        // 煞
        // 来源：6tail/lunar-javascript v1.7.8，日宜忌实现与原始词表
        // https://github.com/6tail/lunar-javascript/blob/v1.7.8/lunar.js
        // 来源：灵昭道苑《择日学》之择日术语；传统实践口径
        // https://www.356.com.tw/teaching/?parent_id=1293
        // 核对：说明当前库的方位标签；不扩写为该方向存在客观危险或不可出门。
        m.put("煞", "忌讳的方位，如煞东、煞西。");
        CONCEPTS = Collections.unmodifiableMap(m);
    }

    // 已核对的同词异写/别名；不是完整的简繁转换表。
    public static final Map<String, String> YI_JI_ALIASES;
    static {
        LinkedHashMap<String, String> m = new LinkedHashMap<String, String>();
        m.put("余事勿取", "馀事勿取");
        m.put("餘事勿取", "馀事勿取");
        m.put("启攒", "启钻");
        m.put("啟攢", "启钻");
        m.put("啟鑽", "启钻");
        m.put("安碓硙", "安碓磑");
        m.put("取鱼", "取渔");
        m.put("取魚", "取渔");
        m.put("取漁", "取渔");
        m.put("造畜稠栈", "造畜稠");
        m.put("造畜稠棧", "造畜稠");
        m.put("造畜稠栖栈", "造畜稠");
        m.put("普度", "普渡");
        m.put("上樑", "上梁");
        m.put("作樑", "作梁");
        m.put("平治道途", "平治道涂");
        m.put("平治道塗", "平治道涂");
        YI_JI_ALIASES = Collections.unmodifiableMap(m);
    }

    // 已核对的同词异写/别名；不是完整的简繁转换表。
    public static final Map<String, String> FESTIVALS_ALIASES;
    static {
        LinkedHashMap<String, String> m = new LinkedHashMap<String, String>();
        m.put("元宵节", "元宵");
        m.put("龙头节", "龙抬头");
        m.put("端午节", "端午");
        m.put("七夕节", "七夕");
        m.put("中元节", "中元");
        m.put("中秋节", "中秋");
        m.put("重阳节", "重阳");
        m.put("腊八节", "腊八");
        m.put("小年（北方）", "小年");
        m.put("感恩节（美国）", "感恩节");
        m.put("诸圣节", "万圣节");
        m.put("Halloween", "万圣夜");
        m.put("All Saints' Day", "万圣节");
        FESTIVALS_ALIASES = Collections.unmodifiableMap(m);
    }
}
